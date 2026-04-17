/**
 * collect-all-png.ts
 *
 * Batch wrapper: enumerate every iframe-form artifact on the page and
 * grab each as a PNG dataUrl via Copy-to-clipboard. Used by pipelines
 * that fill placeholder callouts with images.
 *
 * Why PNG specifically (not SVG):
 *   - Upper layer inserts these into markdown as ![](dataUrl).
 *   - SVG has a Chinese-encoding bug and needs post-processing that
 *     only makes sense once rendered inside a block.
 *   - Rendered PNG is lossy but universally displayable.
 *
 * Serialized by design: each artifact briefly owns the viewport and
 * clipboard; parallel extraction would race.
 */

import { downloadClaudeIframeArtifact, type ViewAPIIframePath } from './iframe-path';
import { ClaudeArtifactDownloadError } from './types';

export interface CollectedPngArtifact {
  /** Merged-list ordinal (cards + standalone iframes, document order). */
  ordinal: number;
  /** `data:image/png;base64,...` */
  dataUrl: string;
  width?: number;
  height?: number;
}

/**
 * Collect all standalone iframe artifacts on the current page as PNG
 * dataUrls, in document order. Skips any capture that fails (caller
 * decides fatality).
 *
 * @param opts.limit cap on how many to try (undefined = all)
 * @param opts.scopeSelector if set, only iframes that are DOM
 *        descendants of the first element matching this selector are
 *        considered. Use this when the caller knows exactly which
 *        message's artifacts to grab — otherwise live-sync and
 *        right-click paths would race the full page and pull in images
 *        from unrelated turns whose iframes happen to be mounted.
 *        Caller is responsible for placing the scope marker (e.g. a
 *        `data-krig-target` attribute) on the correct DOM node.
 */
export async function collectAllIframeArtifactsAsPng(
  webview: Electron.WebviewTag,
  view: ViewAPIIframePath,
  opts?: { limit?: number; perItemTimeoutMs?: number; scopeSelector?: string; preferredOrdinals?: number[] },
): Promise<{
  results: CollectedPngArtifact[];
  skippedCount: number;
  totalDiscovered: number;
}> {
  // Resolve merged-list ordinals of every standalone iframe in one shot,
  // so subsequent per-item calls can address them without re-scanning.
  const iframeOrdinals = await listStandaloneIframeOrdinals(
    webview,
    opts?.scopeSelector,
    opts?.limit,
    opts?.preferredOrdinals,
  );
  const limit = opts?.limit ?? iframeOrdinals.length;
  const target = Math.min(limit, iframeOrdinals.length);

  const results: CollectedPngArtifact[] = [];
  let skippedCount = 0;

  for (let i = 0; i < target; i++) {
    const ordinal = iframeOrdinals[i];
    try {
      const dl = await downloadWithFallback(
        webview,
        view,
        ordinal,
        opts?.perItemTimeoutMs ?? 10_000,
      );
      const dataUrl = bytesToDataUrl(dl.bytes, dl.mime || 'application/octet-stream');
      results.push({
        ordinal,
        dataUrl,
        width: dl.meta.naturalSize?.w,
        height: dl.meta.naturalSize?.h,
      });
    } catch (err) {
      if (err instanceof ClaudeArtifactDownloadError) {
        skippedCount++;
        continue;
      }
      throw err;
    }
  }

  return { results, skippedCount, totalDiscovered: iframeOrdinals.length };
}

async function downloadWithFallback(
  webview: Electron.WebviewTag,
  view: ViewAPIIframePath,
  ordinal: number,
  timeoutMs: number,
) {
  return await downloadClaudeIframeArtifact(
    webview,
    view,
    { ordinal },
    { format: 'svg', timeout: timeoutMs },
  );
}

/**
 * Scan the page once and return the merged-list ordinals (cards + iframes,
 * document order) of every standalone iframe.
 *
 * When `scopeSelector` is provided, only iframes that are DOM
 * descendants of the first element matching that selector are returned.
 * The returned ordinals remain global (relative to the merged
 * cards+iframes list), because the downstream
 * `downloadClaudeIframeArtifact` resolves refs globally.
 */
async function listStandaloneIframeOrdinals(
  webview: Electron.WebviewTag,
  scopeSelector?: string,
  limit?: number,
  preferredOrdinals?: number[],
): Promise<number[]> {
  const scopeExpr = scopeSelector ? JSON.stringify(scopeSelector) : 'null';
  const limitExpr = typeof limit === 'number' ? String(limit) : 'null';
  const preferredExpr = JSON.stringify(preferredOrdinals ?? []);
  const script = `
    (function() {
      var scopeSel = ${scopeExpr};
      var limit = ${limitExpr};
      var preferred = ${preferredExpr};
      var scopeEl = null;
      if (scopeSel) {
        scopeEl = document.querySelector(scopeSel);
        if (!scopeEl) return [];
      }
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
      var contained = [];
      var iframeEntries = [];
      for (var i = 0; i < merged.length; i++) {
        if (merged[i].form !== 'iframe') continue;
        var rect = merged[i].el.getBoundingClientRect();
        var entry = {
          ordinal: i,
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          cx: rect.left + rect.width / 2,
          cy: rect.top + rect.height / 2,
        };
        if (scopeEl && scopeEl.contains(merged[i].el)) contained.push(entry);
        iframeEntries.push(entry);
      }
      if (!scopeEl) {
        if (preferred && preferred.length > 0) {
          var preferredSet0 = new Set(preferred);
          var prioritized0 = iframeEntries.filter(function(e) { return preferredSet0.has(e.ordinal); }).map(function(e) { return e.ordinal; });
          var rest0 = iframeEntries.filter(function(e) { return !preferredSet0.has(e.ordinal); }).map(function(e) { return e.ordinal; });
          return prioritized0.concat(rest0);
        }
        return iframeEntries.map(function(e) { return e.ordinal; });
      }
      if (contained.length > 0) {
        var containedOrdinals = contained.map(function(e) { return e.ordinal; });
        if (preferred && preferred.length > 0) {
          var preferredContained = preferred.filter(function(ord) { return containedOrdinals.indexOf(ord) >= 0; });
          if (preferredContained.length > 0) {
            var restContained = containedOrdinals.filter(function(ord) { return preferredContained.indexOf(ord) < 0; });
            return preferredContained.concat(restContained);
          }
        }
        return containedOrdinals;
      }

      if (preferred && preferred.length > 0) {
        var preferredSet = new Set(preferred);
        var prioritized = iframeEntries.filter(function(e) { return preferredSet.has(e.ordinal); });
        if (prioritized.length > 0) {
          prioritized.sort(function(a, b) { return preferred.indexOf(a.ordinal) - preferred.indexOf(b.ordinal); });
          return prioritized.map(function(e) { return e.ordinal; });
        }
      }

      var scopeRect = scopeEl.getBoundingClientRect();
      var clickX = Number(scopeEl.getAttribute('data-krig-click-x') || 'NaN');
      var clickY = Number(scopeEl.getAttribute('data-krig-click-y') || 'NaN');
      var anchorX = isFinite(clickX) ? clickX : (scopeRect.left + scopeRect.right) / 2;
      var anchorY = isFinite(clickY) ? clickY : (scopeRect.top + scopeRect.bottom) / 2;

      var scored = iframeEntries.map(function(entry) {
        var dx = Math.abs(entry.cx - anchorX);
        var dy = Math.abs(entry.cy - anchorY);
        var verticalPenalty = 0;
        if (entry.bottom < scopeRect.top) verticalPenalty += (scopeRect.top - entry.bottom) * 1.5;
        if (entry.top > scopeRect.bottom) verticalPenalty += (entry.top - scopeRect.bottom) * 0.75;
        var score = dx * 0.35 + dy + verticalPenalty;
        return {
          ordinal: entry.ordinal,
          top: entry.top,
          bottom: entry.bottom,
          score: score,
        };
      });
      scored.sort(function(a, b) { return a.score - b.score; });
      if (scored.length === 0) return [];

      var seed = scored[0];
      var maxItems = (typeof limit === 'number' && limit > 0) ? limit : 1;
      var selected = [seed];
      if (maxItems > 1) {
        for (var j = 1; j < scored.length && selected.length < maxItems; j++) {
          var cand = scored[j];
          var closeToSeed = Math.abs(cand.top - seed.top) <= 420 || Math.abs(cand.bottom - seed.bottom) <= 420;
          var reasonablyClose = cand.score <= seed.score + 520;
          if (closeToSeed && reasonablyClose) selected.push(cand);
        }
      }
      selected.sort(function(a, b) { return a.ordinal - b.ordinal; });
      return selected.map(function(e) { return e.ordinal; });
    })()
  `;
  const r = await webview.executeJavaScript(script).catch(() => []);
  return Array.isArray(r) ? r : [];
}

export async function debugScopedArtifactOrdinals(
  webview: Electron.WebviewTag,
  scopeSelector?: string,
): Promise<Array<{
  ordinal: number;
  form: 'card' | 'iframe';
  inScope: boolean;
  top: number;
  left: number;
  width: number;
  height: number;
  textPreview: string;
}>> {
  const scopeExpr = scopeSelector ? JSON.stringify(scopeSelector) : 'null';
  const script = `
    (function() {
      var scopeSel = ${scopeExpr};
      var scopeEl = scopeSel ? document.querySelector(scopeSel) : null;
      var scopeRect = scopeEl ? scopeEl.getBoundingClientRect() : null;
      var clickX = scopeEl ? Number(scopeEl.getAttribute('data-krig-click-x') || 'NaN') : NaN;
      var clickY = scopeEl ? Number(scopeEl.getAttribute('data-krig-click-y') || 'NaN') : NaN;
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
      return merged.map(function(entry, i) {
        var r = entry.el.getBoundingClientRect();
        var text = '';
        try { text = (entry.el.innerText || entry.el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120); } catch (e) {}
        var cx = r.left + r.width / 2;
        var cy = r.top + r.height / 2;
        var anchorX = isFinite(clickX) ? clickX : (scopeRect ? (scopeRect.left + scopeRect.right) / 2 : cx);
        var anchorY = isFinite(clickY) ? clickY : (scopeRect ? (scopeRect.top + scopeRect.bottom) / 2 : cy);
        var dx = Math.abs(cx - anchorX);
        var dy = Math.abs(cy - anchorY);
        var verticalPenalty = 0;
        if (scopeRect) {
          if (r.bottom < scopeRect.top) verticalPenalty += (scopeRect.top - r.bottom) * 1.5;
          if (r.top > scopeRect.bottom) verticalPenalty += (r.top - scopeRect.bottom) * 0.75;
        }
        return {
          ordinal: i,
          form: entry.form,
          inScope: scopeEl ? scopeEl.contains(entry.el) : true,
          top: Math.round(r.top),
          left: Math.round(r.left),
          width: Math.round(r.width),
          height: Math.round(r.height),
          textPreview: text + ' :: score=' + Math.round(dx * 0.35 + dy + verticalPenalty),
        };
      });
    })()
  `;
  const r = await webview.executeJavaScript(script).catch(() => []);
  return Array.isArray(r) ? r as any : [];
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const b64 = btoa(binary);
  return `data:${mime};base64,${b64}`;
}
