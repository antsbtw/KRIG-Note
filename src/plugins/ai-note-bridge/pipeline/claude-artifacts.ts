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
  fetchClaudeArtifactVersions,
  extractArtifactVersionSource,
  readCapturedArtifactMessages,
  collectArtifactSources,
  replaceArtifactPlaceholders,
} from '../../web-bridge/capabilities/claude-api-extractor';
import { getArtifactPostMessageHookScript } from '../../web-bridge/injection/inject-scripts/artifact-postmessage-hook';
import { collectAllIframeArtifactsAsPng } from '../../web-bridge/capabilities/claude-artifact-download';

declare const viewAPI: unknown;

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
  opts?: { scopeSelector?: string; preferredArtifactOrdinals?: number[] },
): Promise<string> {
  const artifactCount = countArtifactPlaceholders(assistantMsg);
  if (artifactCount === 0) return assistantMsg;
  const scopedSingleTurn = !!opts?.scopeSelector;

  // Make sure the postMessage hook is in place so capturedSources can
  // surface anything Claude posts to its iframe.
  try { await webview.executeJavaScript(getArtifactPostMessageHookScript()); } catch {}

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
      const versions = await fetchClaudeArtifactVersions(webview);
      if (versions && versions.length > 0) {
        versionSources = versions
          .map((v: any) => extractArtifactVersionSource(v))
          .filter((s: string | null): s is string => !!s);
        if (versionSources.length > 0) break;
      }
      await new Promise(r => setTimeout(r, 800));
    }
    const captured = await readCapturedArtifactMessages(webview);
    capturedSources = collectArtifactSources(captured);
  }
  const sources = [...versionSources.slice().reverse(), ...capturedSources];
  const filled = fillArtifactPlaceholders(assistantMsg, sources);
  let out = filled.text;

  if (filled.remaining === 0) return out;

  // Layer 2: rendered PNG via Copy-to-clipboard (CDP mouse simulation).
  const expectedIframes = filled.remaining;
  // Only nudge the currently-targeted message into view. Scrolling every
  // artifact host on the page causes Claude to jump to later visuals,
  // which in turn destabilizes ordinal-based selection and makes the UI
  // look like it is auto-scrolling to the bottom after extraction.
  try {
    const scopeExpr2 = opts?.scopeSelector ? JSON.stringify(opts.scopeSelector) : 'null';
    await webview.executeJavaScript(`
      (function() {
        var scopeSel = ${scopeExpr2};
        if (!scopeSel) return;
        var scopeEl = document.querySelector(scopeSel);
        if (!scopeEl) return;
        scopeEl.scrollIntoView({ block: 'center', behavior: 'instant' });
      })()
    `).catch(() => {});
  } catch {}
  let lastFound = 0;
  const scopeExpr = opts?.scopeSelector ? JSON.stringify(opts.scopeSelector) : 'null';
  for (let attempt = 0; attempt < 20; attempt++) {
    const found = await webview.executeJavaScript(`
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
    `).catch(() => 0);
    lastFound = typeof found === 'number' ? found : 0;
    if (lastFound >= expectedIframes) break;
    await new Promise(r => setTimeout(r, 500));
  }
  try {
    const collected = await collectAllIframeArtifactsAsPng(
      webview,
      viewAPI as any,
      // When the caller marks a scope element (right-click single-turn
      // path tags the target message DOM node), restrict collection to
      // iframes inside that subtree. Without a scope (live-sync
      // tail-message path), page-wide scan is still correct — the only
      // freshly-arrived iframes are from that turn.
      //
      // ×2 on `limit` absorbs side-panel / fullscreen duplicates which
      // dedupe collapses to N unique images.
      {
        limit: expectedIframes * 2,
        scopeSelector: opts?.scopeSelector,
        preferredOrdinals: opts?.preferredArtifactOrdinals,
      },
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
      if (imgFill.remaining > 0) {
        out = replaceArtifactPlaceholders(out, webview.getURL());
      }
      return out;
    }
  } catch (err) {
    console.warn('[AI/Bridge/Claude/Artifact] image fallback failed:', err);
  }

  // Layer 3 fallback.
  return replaceArtifactPlaceholders(out, webview.getURL());
}
