/**
 * Claude Artifact Download — module entry
 *
 * See docs/web/Artifact-Download-Module.md for design rationale.
 *
 * Public surface:
 *   - downloadClaudeArtifact(webview, view, ref, opts)         — facade (auto-dispatch by form)
 *   - downloadClaudeCardArtifact(webview, view, ref, opts)     — card form only
 *   - downloadClaudeIframeArtifact(webview, view, ref, opts)   — iframe form only
 *   - convertIframeToCardInClaude(webview, view, ref, opts)    — §11 Module 5 API  [D5]
 *
 * All functions are Claude-specific. ChatGPT / Gemini artifacts live in
 * their own sibling modules (not this one) — Claude's DOM, menu geometry,
 * SVG encoding bug, and conversation API are all proprietary to Claude.
 */

import { downloadClaudeCardArtifact } from './claude-artifact-download/card-path';
import { downloadClaudeIframeArtifact, type ViewAPIIframePath } from './claude-artifact-download/iframe-path';
import { listAllArtifacts } from './claude-artifact-download/resolve-ref';
import {
  ClaudeArtifactDownloadError,
  type ClaudeArtifactDownload,
  type ClaudeArtifactRef,
} from './claude-artifact-download/types';

export { downloadClaudeCardArtifact, classifyCardKindLabel } from './claude-artifact-download/card-path';
export { downloadClaudeIframeArtifact } from './claude-artifact-download/iframe-path';
export { listAllArtifacts } from './claude-artifact-download/resolve-ref';
export { postProcessClaudeSvg, tryFixMojibake, injectCssFallback, parseViewBox } from './claude-artifact-download/svg-postprocess';
export { convertIframeToCardInClaude, type ConvertIframeToCardResult } from './claude-artifact-download/convert-iframe-to-card';
export {
  collectAllIframeArtifactsAsPng,
  debugScopedArtifactOrdinals,
  type CollectedPngArtifact,
} from './claude-artifact-download/collect-all-png';
export {
  captureOneDownload,
  isDownloadSlotBusy,
  DownloadSlotBusyError,
  DownloadSlotTimeoutError,
  DownloadSlotFailedError,
} from './claude-artifact-download/download-slot';
export {
  ClaudeArtifactDownloadError,
  type ClaudeArtifactKind,
  type ClaudeArtifactRef,
  type ClaudeArtifactDownload,
  type ClaudeArtifactDownloadErrorCode,
} from './claude-artifact-download/types';

// ─────────────────────────────────────────────────────────────
// Facade: auto-dispatch by artifact form
// ─────────────────────────────────────────────────────────────

/**
 * Download a Claude artifact, auto-dispatching to the right path by form.
 *
 * For iframe-form artifacts, defaults to SVG export. Callers wanting PNG
 * should call `downloadClaudeIframeArtifact` directly with format: 'png'.
 *
 * This facade does NOT auto-fallback from SVG to PNG when the encoding
 * fix fails — callers get `meta.encodingFixed = false` and can decide
 * for themselves (SVG → PNG is a lossy downgrade; not our call).
 *
 * Only `ordinal` is supported from renderer callers (DOM node refs can't
 * cross the executeJavaScript boundary).
 */
export async function downloadClaudeArtifact(
  webview: Electron.WebviewTag,
  view: ViewAPIIframePath,
  ref: ClaudeArtifactRef,
  opts?: { timeout?: number; iframeFormat?: 'svg' | 'png' },
): Promise<ClaudeArtifactDownload> {
  if (ref.cardEl !== undefined || ref.iframeEl !== undefined) {
    throw new ClaudeArtifactDownloadError('no-such-artifact', {
      reason: 'cardEl/iframeEl refs cannot cross executeJavaScript boundary; use ordinal',
    });
  }
  if (typeof ref.ordinal !== 'number') {
    throw new ClaudeArtifactDownloadError('no-such-artifact', { reason: 'ordinal required' });
  }

  // Dispatch: probe the form by asking the guest to inspect DOM.
  const form = await probeFormByOrdinal(webview, ref.ordinal);

  if (form === 'card') {
    return await downloadClaudeCardArtifact(webview, view, ref, { timeout: opts?.timeout });
  } else {
    return await downloadClaudeIframeArtifact(webview, view, ref, {
      format: opts?.iframeFormat ?? 'svg',
      timeout: opts?.timeout,
    });
  }
}

async function probeFormByOrdinal(
  webview: Electron.WebviewTag,
  ordinal: number,
): Promise<'card' | 'iframe'> {
  // Use attribute selector [class*="..."] to avoid escaping the slash in the
  // Tailwind "group/artifact-block" class.
  const script = `
    (function() {
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
      var entry = merged[${ordinal}];
      return entry ? entry.form : null;
    })()
  `;
  const r = await webview.executeJavaScript(script);
  if (r !== 'card' && r !== 'iframe') {
    throw new ClaudeArtifactDownloadError('no-such-artifact', { ordinal });
  }
  return r;
}

// listAllArtifacts is a DOM-side helper (runs only if caller executes it in guest).

// Silence unused warning — kept so the facade can share the helper across future usage.
void listAllArtifacts;
