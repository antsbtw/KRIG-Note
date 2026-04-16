/**
 * Claude Artifact placeholder processing.
 *
 * Three layers, in order of fidelity:
 *   1. Versions API + postMessage source (real markup when exposed)
 *   2. Copy-to-clipboard rendered PNG via CDP mouse simulation
 *   3. Friendly callout asking the user to click Claude's own copy
 *      button on the page (last resort; used by live chat sync)
 *
 * The save-to-note flow runs all three. Live chat sync skips layer 2
 * (it would interfere with the user's reading) and goes straight to
 * the layer-3 callout when a placeholder is present.
 */

import {
  countArtifactPlaceholders,
  fillArtifactPlaceholders,
  fillArtifactPlaceholdersWithImages,
  fillArtifactPlaceholdersWithMarkdownPieces,
  fillArtifactPlaceholdersWithSparseMarkdownPieces,
  fetchClaudeArtifactVersions,
  extractArtifactVersionSource,
  readCapturedArtifactMessages,
  collectArtifactSources,
  replaceArtifactPlaceholders,
  trimLeadingArtifactPlaceholder,
} from '../../web-bridge/capabilities/claude-api-extractor';
import { getArtifactPostMessageHookScript } from '../../web-bridge/injection/inject-scripts/artifact-postmessage-hook';
import { collectAllIframeArtifactsAsPng } from '../../web-bridge/capabilities/claude-artifact-download';
import { downloadClaudeArtifact } from '../../web-bridge/capabilities/claude-artifact-download';

declare const viewAPI: unknown;

function withStepTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function writeStageDebugSnapshot(payload: {
  extractionId?: string;
  stage: string;
  serviceId?: string;
  url?: string;
  markdown: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    const api = viewAPI as { aiExtractionCacheWrite?: (payload: any) => Promise<any> };
    await api.aiExtractionCacheWrite?.(payload);
  } catch {}
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function normalizeFenceLanguage(raw: string): string {
  const lang = (raw || '').trim().toLowerCase();
  if (!lang) return 'text';
  if (lang === 'js' || lang === 'javascript') return 'javascript';
  if (lang === 'ts') return 'typescript';
  if (lang === 'py') return 'python';
  if (lang === 'md') return 'markdown';
  return lang;
}

function artifactDownloadToMarkdownPiece(dl: Awaited<ReturnType<typeof downloadClaudeArtifact>>): string {
  if (dl.kind.form === 'iframe') {
    return `![Claude Artifact](${bytesToDataUrl(dl.bytes, dl.mime || 'image/svg+xml')})`;
  }

  const text = new TextDecoder('utf-8', { fatal: false }).decode(dl.bytes);
  if (dl.kind.cardType === 'diagram') {
    const lang = normalizeFenceLanguage(dl.kind.format || 'mermaid');
    return `\`\`\`${lang}\n${text.trimEnd()}\n\`\`\``;
  }
  if (dl.kind.cardType === 'html') {
    return `\`\`\`html\n${text.trimEnd()}\n\`\`\``;
  }
  if (dl.kind.cardType === 'document') {
    const format = normalizeFenceLanguage(dl.kind.format || 'text');
    if (format === 'markdown') return text.trimEnd();
    return `\`\`\`${format}\n${text.trimEnd()}\n\`\`\``;
  }
  return `\`\`\`${normalizeFenceLanguage(dl.kind.language)}\n${text.trimEnd()}\n\`\`\``;
}

async function listRelevantArtifactOrdinals(
  webview: Electron.WebviewTag,
  scopeSelector?: string,
  limit?: number,
  preferredOrdinals?: number[],
): Promise<number[]> {
  const scopeExpr = scopeSelector ? JSON.stringify(scopeSelector) : 'null';
  const limitExpr = typeof limit === 'number' ? String(limit) : 'null';
  const preferredExpr = JSON.stringify(preferredOrdinals ?? []);
  const script = `
    (async function() {
      var scopeSel = ${scopeExpr};
      var limit = ${limitExpr};
      var preferred = ${preferredExpr};
      function buildMerged() {
        var cards = Array.from(document.querySelectorAll('[class*="group/artifact-block"]'));
        var allIframes = Array.from(document.querySelectorAll('iframe[src*="claudemcpcontent"]'));
        var standaloneIframes = allIframes.filter(function(f) {
          var p = f.parentElement;
          while (p) {
            if (p.className && String(p.className).indexOf('group/artifact-block') >= 0) return false;
            p = p.parentElement;
          }
          return true;
        });
        var merged = cards.map(function(el) { return { form: 'card', el: el }; })
          .concat(standaloneIframes.map(function(el) { return { form: 'iframe', el: el }; }));
        merged.sort(function(a, b) {
          var rel = a.el.compareDocumentPosition(b.el);
          if (rel & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
          if (rel & Node.DOCUMENT_POSITION_PRECEDING) return 1;
          return 0;
        });
        return merged;
      }
      function buildEntries(merged, scopeEl) {
        return merged.map(function(entry, ordinal) {
          var rect = entry.el.getBoundingClientRect();
          return {
            ordinal: ordinal,
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
            cx: rect.left + rect.width / 2,
            cy: rect.top + rect.height / 2,
            inScope: scopeEl ? scopeEl.contains(entry.el) : true,
          };
        });
      }
      var scopeEl = null;
      if (scopeSel) {
        scopeEl = document.querySelector(scopeSel);
        if (!scopeEl) return [];
      }
      var merged = buildMerged();
      var entries = buildEntries(merged, scopeEl);

      if (!scopeEl) {
        if (preferred.length > 0) {
          var prefSet0 = new Set(preferred);
          return entries
            .sort(function(a, b) {
              var ap = prefSet0.has(a.ordinal) ? preferred.indexOf(a.ordinal) : 999999;
              var bp = prefSet0.has(b.ordinal) ? preferred.indexOf(b.ordinal) : 999999;
              if (ap !== bp) return ap - bp;
              return a.ordinal - b.ordinal;
            })
            .map(function(e) { return e.ordinal; });
        }
        return entries.map(function(e) { return e.ordinal; });
      }

      var inScope = entries.filter(function(e) { return e.inScope; });
      if (inScope.length > 0) {
        if (preferred.length > 0) {
          var prefSet1 = new Set(preferred);
          inScope.sort(function(a, b) {
            var ap = prefSet1.has(a.ordinal) ? preferred.indexOf(a.ordinal) : 999999;
            var bp = prefSet1.has(b.ordinal) ? preferred.indexOf(b.ordinal) : 999999;
            if (ap !== bp) return ap - bp;
            return a.ordinal - b.ordinal;
          });
        }
        return inScope.map(function(e) { return e.ordinal; });
      }

      var scopeRect = scopeEl.getBoundingClientRect();
      // Long Claude turns often mount artifact cards/iframes lazily only
      // after the user scrolls deeper into the reply. For scoped turn
      // extraction, scan the target turn vertically to materialize more
      // artifact DOM before falling back to nearest-neighbor guessing.
      var docTop = (window.scrollY || window.pageYOffset || 0) + scopeRect.top;
      var docBottom = docTop + scopeRect.height;
      var originalScrollY = window.scrollY || window.pageYOffset || 0;
      var viewH = window.innerHeight || document.documentElement.clientHeight || 800;
      var scanStart = Math.max(0, Math.floor(docTop - viewH * 0.2));
      var scanEnd = Math.max(scanStart, Math.floor(docBottom - viewH * 0.6));
      var step = Math.max(220, Math.floor(viewH * 0.55));
      var seenOrdinals = [];
      var seenSet = new Set();
      for (var pos = scanStart; pos <= scanEnd; pos += step) {
        try {
          window.__krigAllowProgrammaticScroll = true;
          window.scrollTo(0, pos);
          window.__krigAllowProgrammaticScroll = false;
        } catch (e) {}
        await new Promise(function(r) { setTimeout(r, 120); });
        merged = buildMerged();
        entries = buildEntries(merged, scopeEl);
        for (var si = 0; si < entries.length; si++) {
          var node = merged[entries[si].ordinal].el;
          var rect = node.getBoundingClientRect();
          var centerDocY = (window.scrollY || window.pageYOffset || 0) + rect.top + rect.height / 2;
          var visible = rect.bottom > -20 && rect.top < viewH + 20 && rect.height > 8;
          var inBand = centerDocY >= docTop - 80 && centerDocY <= docBottom + 120;
          if (visible && inBand && !seenSet.has(entries[si].ordinal)) {
            seenSet.add(entries[si].ordinal);
            seenOrdinals.push(entries[si].ordinal);
          }
        }
      }
      try {
        window.__krigAllowProgrammaticScroll = true;
        window.scrollTo(0, originalScrollY);
        window.__krigAllowProgrammaticScroll = false;
      } catch (e) {}
      merged = buildMerged();
      entries = buildEntries(merged, scopeEl);
      if (seenOrdinals.length > 0) {
        if (preferred.length > 0) {
          var prefSetScan = new Set(preferred);
          seenOrdinals.sort(function(a, b) {
            var ap = prefSetScan.has(a) ? preferred.indexOf(a) : 999999;
            var bp = prefSetScan.has(b) ? preferred.indexOf(b) : 999999;
            if (ap !== bp) return ap - bp;
            return a - b;
          });
        } else {
          seenOrdinals.sort(function(a, b) { return a - b; });
        }
        return seenOrdinals.slice(0, (typeof limit === 'number' && limit > 0) ? limit : seenOrdinals.length);
      }

      var clickX = Number(scopeEl.getAttribute('data-krig-click-x') || 'NaN');
      var clickY = Number(scopeEl.getAttribute('data-krig-click-y') || 'NaN');
      var anchorX = isFinite(clickX) ? clickX : (scopeRect.left + scopeRect.right) / 2;
      var anchorY = isFinite(clickY) ? clickY : (scopeRect.top + scopeRect.bottom) / 2;

      var scored = entries.map(function(entry) {
        var dx = Math.abs(entry.cx - anchorX);
        var dy = Math.abs(entry.cy - anchorY);
        var verticalPenalty = 0;
        if (entry.bottom < scopeRect.top) verticalPenalty += (scopeRect.top - entry.bottom) * 1.5;
        if (entry.top > scopeRect.bottom) verticalPenalty += (entry.top - scopeRect.bottom) * 0.75;
        return { ordinal: entry.ordinal, score: dx * 0.35 + dy + verticalPenalty, top: entry.top, bottom: entry.bottom };
      });
      scored.sort(function(a, b) { return a.score - b.score; });
      if (preferred.length > 0) {
        var prefSet2 = new Set(preferred);
        scored.sort(function(a, b) {
          var ap = prefSet2.has(a.ordinal) ? preferred.indexOf(a.ordinal) : 999999;
          var bp = prefSet2.has(b.ordinal) ? preferred.indexOf(b.ordinal) : 999999;
          if (ap !== bp) return ap - bp;
          return a.score - b.score;
        });
      }
      var maxItems = (typeof limit === 'number' && limit > 0) ? limit : 1;
      return scored.slice(0, maxItems).map(function(e) { return e.ordinal; });
    })()
  `;
  const result = await webview.executeJavaScript(script).catch(() => []);
  return Array.isArray(result) ? result : [];
}

async function collectScopedArtifactMarkdownPieces(
  webview: Electron.WebviewTag,
  expectedCount: number,
  opts?: { scopeSelector?: string; preferredArtifactOrdinals?: number[]; ordinals?: number[]; perItemTimeoutMs?: number },
): Promise<{ pieces: Array<string | null>; ordinals: number[]; successCount: number }> {
  const ordinals = opts?.ordinals ?? await listRelevantArtifactOrdinals(
    webview,
    opts?.scopeSelector,
    Math.max(1, expectedCount * 2),
    opts?.preferredArtifactOrdinals,
  );
  const selectedOrdinals = ordinals.slice(0, Math.max(1, expectedCount));
  const pieces: Array<string | null> = new Array(selectedOrdinals.length).fill(null);
  let successCount = 0;
  const perItemTimeoutMs = opts?.perItemTimeoutMs ?? 4_000;
  for (let i = 0; i < selectedOrdinals.length; i++) {
    const ordinal = selectedOrdinals[i];
    try {
      const dl = await downloadClaudeArtifact(
        webview,
        viewAPI as any,
        { ordinal },
        { iframeFormat: 'svg', timeout: perItemTimeoutMs },
      );
      pieces[i] = artifactDownloadToMarkdownPiece(dl);
      successCount += 1;
    } catch {}
  }
  return { pieces, ordinals: selectedOrdinals, successCount };
}

/**
 * Live chat path: never invoke CDP. Replace any placeholder with a
 * "go click Claude's copy button" callout so the user knows where the
 * artifact would have been.
 */
export function processClaudeArtifactsLive(
  assistantMsg: string,
  conversationUrl: string,
): string {
  if (countArtifactPlaceholders(assistantMsg) === 0) return assistantMsg;
  return replaceArtifactPlaceholders(assistantMsg, conversationUrl);
}

/**
 * Save-to-note path: try every fidelity layer in turn, ending with
 * the callout if even CDP fails. Designed to be called from the
 * serial pipeline so multiple turns don't compete for CDP / clipboard
 * at the same time.
 */
export async function processClaudeArtifactsFull(
  webview: Electron.WebviewTag,
  assistantMsg: string,
  opts?: { scopeSelector?: string; preferredArtifactOrdinals?: number[]; extractionId?: string; pageUrl?: string },
): Promise<string> {
  let normalizedMsg = trimLeadingArtifactPlaceholder(assistantMsg);
  const artifactCount = countArtifactPlaceholders(normalizedMsg);
  if (artifactCount === 0) return normalizedMsg;
  const scopedSingleTurn = !!opts?.scopeSelector;
  const explicitArtifactTarget = !!(opts?.preferredArtifactOrdinals && opts.preferredArtifactOrdinals.length > 0);
  const pageUrl = opts?.pageUrl || webview.getURL?.() || '';

  // Make sure the postMessage hook is in place so capturedSources can
  // surface anything Claude posts to its iframe.
  if (!scopedSingleTurn) {
    try {
      await withStepTimeout(
        webview.executeJavaScript(getArtifactPostMessageHookScript()),
        2_000,
        'artifact-postmessage-hook',
      );
    } catch {}
  }

  // Layer 1 is conversation-global: versions API + captured postMessage
  // sources are not tagged with a turn/message id. For scoped right-click
  // extraction that means an older turn's artifact can be matched into the
  // newly selected turn, causing cross-turn image/source bleed. In the
  // scoped path we skip Layer 1 entirely and rely on DOM-scoped iframe
  // capture below, which is the only turn-local signal we have.
  let versionSources: string[] = [];
  let capturedSources: string[] = [];
  if (!scopedSingleTurn) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const versions = await withStepTimeout(
        fetchClaudeArtifactVersions(webview),
        2_500,
        'fetchClaudeArtifactVersions',
      ).catch(() => null);
      if (versions && versions.length > 0) {
        versionSources = versions
          .map((v: any) => extractArtifactVersionSource(v))
          .filter((s: string | null): s is string => !!s);
        if (versionSources.length > 0) break;
      }
      await new Promise(r => setTimeout(r, 800));
    }
    const captured = await withStepTimeout(
      readCapturedArtifactMessages(webview),
      1_500,
      'readCapturedArtifactMessages',
    ).catch(() => []);
    capturedSources = collectArtifactSources(captured);
  }
  const sources = [...versionSources.slice().reverse(), ...capturedSources];
  const filled = fillArtifactPlaceholders(normalizedMsg, sources);
  let out = filled.text;
  await writeStageDebugSnapshot({
    extractionId: opts?.extractionId,
    stage: 'artifact-layer1',
    serviceId: 'claude',
    url: pageUrl,
    markdown: out,
    meta: {
      artifactCount,
      layer: 1,
      filled: filled.filled,
      remaining: filled.remaining,
      versionSources: versionSources.length,
      capturedSources: capturedSources.length,
    },
  });

  if (filled.remaining === 0) return out;

  // Layer 2: DOM-scoped artifact download (cards + iframe artifacts).
  const expectedIframes = filled.remaining;
  const ordinalHints = expectedIframes === 1 ? opts?.preferredArtifactOrdinals : undefined;
  // Only nudge the currently-targeted message into view. Scrolling every
  // artifact host on the page causes Claude to jump to later visuals,
  // which in turn destabilizes ordinal-based selection and makes the UI
  // look like it is auto-scrolling to the bottom after extraction.
  try {
    const scopeExpr2 = opts?.scopeSelector ? JSON.stringify(opts.scopeSelector) : 'null';
    await withStepTimeout(
      webview.executeJavaScript(`
        (function() {
          var scopeSel = ${scopeExpr2};
          if (!scopeSel) return;
          var scopeEl = document.querySelector(scopeSel);
          if (!scopeEl) return;
          scopeEl.scrollIntoView({ block: 'center', behavior: 'instant' });
        })()
      `),
      1_500,
      'artifact-scope-scroll-into-view',
    ).catch(() => {});
  } catch {}
  let lastFound = 0;
  const scopeExpr = opts?.scopeSelector ? JSON.stringify(opts.scopeSelector) : 'null';
  for (let attempt = 0; attempt < 20; attempt++) {
    const found = await withStepTimeout(
      webview.executeJavaScript(`
        (function() {
          var scopeSel = ${scopeExpr};
          var scopeEl = scopeSel ? document.querySelector(scopeSel) : null;
          if (scopeSel && !scopeEl) return 0;
          var all = Array.from(document.querySelectorAll('iframe[src*="claudemcpcontent"], iframe[src*="claudeusercontent"]'));
          if (!scopeEl) return all.length;
          var count = 0;
          for (var i = 0; i < all.length; i++) {
            if (scopeEl.contains(all[i])) count++;
          }
          return count;
        })()
      `),
      1_500,
      'artifact-scope-iframe-count',
    ).catch(() => 0);
    lastFound = typeof found === 'number' ? found : 0;
    if (lastFound >= expectedIframes) break;
    await new Promise(r => setTimeout(r, 500));
  }
  try {
    const candidateOrdinals = await withStepTimeout(
      listRelevantArtifactOrdinals(
        webview,
        opts?.scopeSelector,
        Math.max(1, expectedIframes * 2),
        ordinalHints,
      ),
      4_000,
      'listRelevantArtifactOrdinals',
    ).catch(() => []);
    const canApplyMixed =
      expectedIframes === 1 ||
      explicitArtifactTarget ||
      candidateOrdinals.length === expectedIframes;
    if (candidateOrdinals.length > 0 && canApplyMixed) {
      const mixedResult = await withStepTimeout(
        collectScopedArtifactMarkdownPieces(webview, expectedIframes, {
          scopeSelector: opts?.scopeSelector,
          preferredArtifactOrdinals: ordinalHints,
          ordinals: candidateOrdinals,
          perItemTimeoutMs: 4_000,
        }),
        Math.max(5_000, candidateOrdinals.length * 4_500),
        'collectScopedArtifactMarkdownPieces',
      );
      const mixedFill = fillArtifactPlaceholdersWithSparseMarkdownPieces(out, mixedResult.pieces);
      out = mixedFill.text;
      await writeStageDebugSnapshot({
        extractionId: opts?.extractionId,
        stage: 'artifact-layer2-mixed',
        serviceId: 'claude',
        url: pageUrl,
        markdown: out,
        meta: {
          layer: 2,
          expected: expectedIframes,
          candidates: mixedResult.ordinals.length,
          candidateOrdinals: mixedResult.ordinals,
          pieces: mixedResult.successCount,
          remaining: mixedFill.remaining,
          applied: true,
        },
      });
      if (mixedFill.remaining === 0) return out;
    } else if (candidateOrdinals.length > 0 || expectedIframes > 1) {
      await writeStageDebugSnapshot({
        extractionId: opts?.extractionId,
        stage: 'artifact-layer2-mixed',
        serviceId: 'claude',
        url: pageUrl,
        markdown: out,
        meta: {
          layer: 2,
          expected: expectedIframes,
          candidates: candidateOrdinals.length,
          candidateOrdinals: candidateOrdinals,
          pieces: 0,
          remaining: expectedIframes,
          applied: false,
          reason: canApplyMixed ? 'no-successful-downloads' : 'candidate-count-mismatch',
        },
      });
    }

    if (!canApplyMixed && expectedIframes > 1 && !explicitArtifactTarget) {
      out = replaceArtifactPlaceholders(out, webview.getURL());
      await writeStageDebugSnapshot({
        extractionId: opts?.extractionId,
        stage: 'artifact-layer3-fallback',
        serviceId: 'claude',
        url: pageUrl,
        markdown: out,
        meta: { layer: 3, reason: 'fast-fallback-candidate-mismatch', expected: expectedIframes, candidates: candidateOrdinals.length },
      });
      return out;
    }

    const collected = await withStepTimeout(
      collectAllIframeArtifactsAsPng(
        webview,
        viewAPI as any,
        {
          limit: Math.min(expectedIframes * 2, 4),
          perItemTimeoutMs: 4_000,
          scopeSelector: opts?.scopeSelector,
          preferredOrdinals: ordinalHints,
        },
      ),
      8_000,
      'collectAllIframeArtifactsAsPng',
    );
    const rawImgs = collected.results.map(r => r.dataUrl);
    const seen = new Set<string>();
    const imgs: string[] = [];
    for (const u of rawImgs) {
      if (seen.has(u)) continue;
      seen.add(u);
      imgs.push(u);
    }
    if (imgs.length > 0) {
      const imgFill = fillArtifactPlaceholdersWithImages(out, imgs);
      out = imgFill.text;
      await writeStageDebugSnapshot({
        extractionId: opts?.extractionId,
        stage: 'artifact-layer2-iframe',
        serviceId: 'claude',
        url: pageUrl,
        markdown: out,
        meta: {
          layer: 2,
          rawImages: rawImgs.length,
          uniqueImages: imgs.length,
          remaining: imgFill.remaining,
        },
      });
      if (imgFill.remaining > 0) {
        out = replaceArtifactPlaceholders(out, pageUrl);
        await writeStageDebugSnapshot({
          extractionId: opts?.extractionId,
          stage: 'artifact-layer3-fallback',
          serviceId: 'claude',
          url: pageUrl,
          markdown: out,
          meta: { layer: 3, reason: 'remaining-after-iframe-fill', remaining: imgFill.remaining },
        });
      }
      return out;
    }
  } catch (err) {
    console.warn('[AI/Bridge/Claude/Artifact] image fallback failed:', err);
  }

  // Layer 3 fallback.
  out = replaceArtifactPlaceholders(out, pageUrl);
  await writeStageDebugSnapshot({
    extractionId: opts?.extractionId,
    stage: 'artifact-layer3-fallback',
    serviceId: 'claude',
    url: pageUrl,
    markdown: out,
    meta: { layer: 3, reason: 'direct-fallback' },
  });
  return out;
}
