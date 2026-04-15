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
import { extractAll as extractAllClaudeArtifacts } from '../../web-bridge/capabilities/claude-artifact-extractor';

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
): Promise<string> {
  const artifactCount = countArtifactPlaceholders(assistantMsg);
  if (artifactCount === 0) return assistantMsg;

  // Make sure the postMessage hook is in place so capturedSources can
  // surface anything Claude posts to its iframe.
  try { await webview.executeJavaScript(getArtifactPostMessageHookScript()); } catch {}

  // Layer 1: versions API (Claude often returns []; brief polling).
  let versionSources: string[] = [];
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
  const capturedSources = collectArtifactSources(captured);
  const sources = [...versionSources.slice().reverse(), ...capturedSources];
  const filled = fillArtifactPlaceholders(assistantMsg, sources);
  console.log(`[AI/Bridge/Claude/Artifact] versions=${versionSources.length} captured=${capturedSources.length} filled=${filled.filled}/${artifactCount}`);
  let out = filled.text;

  if (filled.remaining === 0) return out;

  // Layer 2: rendered PNG via Copy-to-clipboard (CDP mouse simulation).
  const expectedIframes = filled.remaining;
  // Nudge artifact host elements into view to trigger lazy mount.
  try {
    await webview.executeJavaScript(`
      (function() {
        var hosts = document.querySelectorAll('[class*="artifact"], [data-testid*="artifact"]');
        for (var i = 0; i < hosts.length; i++) hosts[i].scrollIntoView({ block: 'center', behavior: 'instant' });
      })()
    `).catch(() => {});
  } catch {}
  let lastFound = 0;
  for (let attempt = 0; attempt < 20; attempt++) {
    const found = await webview.executeJavaScript(
      'document.querySelectorAll(\'iframe[src*="claudemcpcontent"], iframe[src*="claudeusercontent"]\').length',
    ).catch(() => 0);
    lastFound = typeof found === 'number' ? found : 0;
    if (lastFound >= expectedIframes) break;
    await new Promise(r => setTimeout(r, 500));
  }
  console.log(`[AI/Bridge/Claude/Artifact] iframe wait: found=${lastFound} expected=${expectedIframes}`);

  try {
    const artifacts = await extractAllClaudeArtifacts(
      webview,
      viewAPI as any,
      { image: true },
      // Only grab iframes belonging to the current turn — older ones
      // are still in the DOM but already synced. ×2 absorbs
      // side-panel / fullscreen duplicates which dedupe collapses.
      expectedIframes * 2,
    );
    const rawImgs = artifacts.map(a => a.image?.dataUrl).filter((s): s is string => !!s);
    const seen = new Set<string>();
    const imgs: string[] = [];
    for (const u of rawImgs) {
      if (seen.has(u)) continue;
      seen.add(u);
      imgs.push(u);
    }
    console.log(`[AI/Bridge/Claude/Artifact] CDP image capture: ${imgs.length} unique image(s) (raw=${rawImgs.length}) for ${expectedIframes} expected; descriptors=${artifacts.length}`);
    if (imgs.length > 0) {
      const imgFill = fillArtifactPlaceholdersWithImages(out, imgs);
      out = imgFill.text;
      console.log(`[AI/Bridge/Claude/Artifact] image fill ${imgFill.filled}/${imgs.length}, remaining ${imgFill.remaining}`);
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
