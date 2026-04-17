/**
 * card-path.ts
 *
 * Download a card-form artifact: click its in-card Download button and
 * capture the resulting download via the main-process will-download hook.
 *
 * Card artifacts live in the main Claude document (not a cross-origin
 * iframe), so a plain `button.click()` is enough to trigger download —
 * no CDP mouse synthesis needed. React's synthetic onClick handlers fire
 * correctly in response.
 *
 * All DOM inspection is done inside the guest page via executeJavaScript.
 * The renderer side only orchestrates: arm download slot → ask guest to
 * click → await bytes.
 */

import {
  CARD_ROOT_SELECTOR,
  CARD_DOWNLOAD_BUTTON_SELECTOR,
  CARD_TITLE_SELECTOR,
  CARD_KIND_LABEL_SELECTOR,
  IFRAME_SELECTOR,
} from './claude-ui-constants';
import {
  captureOneDownload,
  type ViewAPIDownloadCapture,
} from './download-slot';
import {
  ClaudeArtifactDownloadError,
  type ClaudeArtifactDownload,
  type ClaudeArtifactKind,
  type ClaudeArtifactRef,
} from './types';

// ─────────────────────────────────────────────────────────────
// Guest-side metadata probe + click, returned to renderer as JSON.
// Runs inside the Claude page via executeJavaScript — must be ES5-safe
// (no optional chaining, no const in some older embedded V8 builds —
// claude.ai is modern so const is fine, but we keep it simple).
// ─────────────────────────────────────────────────────────────

/**
 * Build the injection script. Reads the card identified by ref, probes
 * its kind+title, clicks its Download button, and returns metadata so
 * the renderer can assemble a ClaudeArtifactDownload.
 *
 * The script returns one of:
 *   { ok: true, title, rawKindLabel, ariaLabel }
 *   { ok: false, code: 'no-such-artifact' | 'wrong-form' | 'card-button-not-found', detail?: ... }
 */
function buildProbeAndClickScript(ref: ClaudeArtifactRef): string {
  const ordinalExpr =
    typeof ref.ordinal === 'number' ? String(ref.ordinal) : 'null';

  // cardEl / iframeEl refs can't cross the executeJavaScript boundary
  // (DOM nodes aren't JSON-serializable). Only `ordinal` is supported
  // from the renderer. cardEl-based refs are used only when the caller
  // is itself running inside the guest; renderer callers must pass
  // ordinal.
  //
  // If someone passes cardEl from renderer, we reject with clear error.
  const refModeGuard =
    ref.cardEl !== undefined || ref.iframeEl !== undefined
      ? `return { ok: false, code: 'no-such-artifact', detail: { reason: 'cardEl/iframeEl refs cannot cross executeJavaScript boundary; use ordinal' } };`
      : '';

  return `
    (function() {
      ${refModeGuard}
      var ordinal = ${ordinalExpr};
      if (ordinal == null) {
        return { ok: false, code: 'no-such-artifact', detail: { reason: 'ordinal required' } };
      }

      // List all artifacts in document order (cards + standalone iframes).
      var cards = Array.from(document.querySelectorAll(${JSON.stringify(CARD_ROOT_SELECTOR)})).filter(function(el) {
        var p = el.parentElement;
        while (p) {
          var cls = '';
          try { cls = (p.className && String(p.className)) || ''; } catch (e) {}
          if (cls.indexOf('group/artifact-block') >= 0) return false;
          p = p.parentElement;
        }
        var btns = Array.from(el.querySelectorAll('button, [role="button"], a'));
        for (var bi = 0; bi < btns.length; bi++) {
          var b = btns[bi];
          var label = ((b.innerText || b.textContent || '') + ' ' +
            (b.getAttribute('aria-label') || '') + ' ' +
            (b.getAttribute('title') || '')).toLowerCase();
          if (label.indexOf('download') >= 0) return true;
        }
        return false;
      });
      var allIframes = Array.from(document.querySelectorAll(${JSON.stringify(IFRAME_SELECTOR)}));
      var merged = cards.map(function(el) { return { form: 'card', el: el }; })
        .concat(allIframes.map(function(el) { return { form: 'iframe', el: el }; }));

      // Sort by document order.
      merged.sort(function(a, b) {
        var rel = a.el.compareDocumentPosition(b.el);
        if (rel & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (rel & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });

      var entry = merged[ordinal];
      if (!entry) {
        return { ok: false, code: 'no-such-artifact', detail: { ordinal: ordinal, totalFound: merged.length } };
      }
      if (entry.form !== 'card') {
        return { ok: false, code: 'wrong-form', detail: { expected: 'card', actual: entry.form } };
      }

      var card = entry.el;

      // Read metadata.
      var titleEl = card.querySelector(${JSON.stringify(CARD_TITLE_SELECTOR)});
      var labelEl = card.querySelector(${JSON.stringify(CARD_KIND_LABEL_SELECTOR)});
      var title = titleEl ? (titleEl.textContent || '').trim() : '';
      var rawKindLabel = labelEl ? (labelEl.textContent || '').trim() : '';

      // Find and click the Download button.
      var btn = null;
      var btns = Array.from(card.querySelectorAll('button, [role="button"], a'));
      for (var bi = 0; bi < btns.length; bi++) {
        var cand = btns[bi];
        var label = ((cand.innerText || cand.textContent || '') + ' ' +
          (cand.getAttribute('aria-label') || '') + ' ' +
          (cand.getAttribute('title') || '')).toLowerCase();
        if (label.indexOf('download') >= 0) { btn = cand; break; }
      }
      if (!btn) {
        return { ok: false, code: 'card-button-not-found' };
      }
      var ariaLabel = btn.getAttribute('aria-label') || '';

      // Scroll the card into view so users see what's happening (and to
      // keep behavior consistent with iframe path which NEEDS viewport).
      card.scrollIntoView({ block: 'center', behavior: 'instant' });

      btn.click();

      return { ok: true, title: title, rawKindLabel: rawKindLabel, ariaLabel: ariaLabel };
    })()
  `;
}

/**
 * Classify a raw "Kind · FORMAT" label into ClaudeArtifactKind.
 * Exported so probe-card-kind.ts and tests can share it; also used when
 * the renderer receives rawKindLabel back from the guest.
 */
export function classifyCardKindLabel(raw: string): ClaudeArtifactKind {
  if (!raw) throw new ClaudeArtifactDownloadError('unknown-card-type', { raw: '(empty)' });
  const parts = raw.split(/\s*[·.]\s*/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) throw new ClaudeArtifactDownloadError('unknown-card-type', { raw });
  const kind = parts[0].toLowerCase();
  const format = parts[1].toLowerCase();
  if (kind === 'code') {
    if (format === 'html') return { form: 'card', cardType: 'html' };
    return { form: 'card', cardType: 'code', language: format };
  }
  if (kind === 'document') return { form: 'card', cardType: 'document', format };
  if (kind === 'diagram') return { form: 'card', cardType: 'diagram', format };
  throw new ClaudeArtifactDownloadError('unknown-card-type', { raw });
}

/**
 * Download a card-form Claude artifact.
 *
 * @param webview Electron webview tag hosting the Claude page
 * @param view renderer-side viewAPI (needs wbCaptureDownloadOnce)
 * @param ref Which artifact; only `ordinal` is supported from renderer
 *            (DOM node refs can't cross the executeJavaScript boundary)
 * @param opts.timeout Max wait for will-download (default 10s)
 */
export async function downloadClaudeCardArtifact(
  webview: Electron.WebviewTag,
  view: ViewAPIDownloadCapture,
  ref: ClaudeArtifactRef,
  opts?: { timeout?: number },
): Promise<ClaudeArtifactDownload> {
  const timeout = opts?.timeout ?? 10_000;
  const startedAt = Date.now();

  // Arm the main-side download listener BEFORE clicking, so it races
  // correctly with will-download.
  const capturePromise = captureOneDownload(view, timeout);

  // Probe + click in one round-trip.
  let probe: {
    ok: boolean;
    code?: string;
    detail?: unknown;
    title?: string;
    rawKindLabel?: string;
    ariaLabel?: string;
  };
  try {
    probe = await webview.executeJavaScript(buildProbeAndClickScript(ref));
  } catch (err) {
    // If the script itself throws (shouldn't happen — we catch inside),
    // the capture is already armed. Wait for its timeout so we don't
    // leave a dangling listener.
    await capturePromise.catch(() => undefined);
    throw err;
  }

  if (!probe.ok) {
    // Script rejected. Still need to drain the armed capture — it'll
    // time out harmlessly. We surface the probe error.
    await capturePromise.catch(() => undefined);
    throw new ClaudeArtifactDownloadError(
      probe.code as never,
      probe.detail as Record<string, unknown> | undefined,
    );
  }

  // Now await the actual download. captureOneDownload already encodes
  // timeout semantics — let it propagate.
  const dl = await capturePromise;
  const kind = classifyCardKindLabel(probe.rawKindLabel ?? '');

  return {
    bytes: dl.bytes,
    mime: dl.mimeType,
    filename: dl.filename,
    kind,
    title: probe.title ?? '',
    meta: {
      pathTaken: 'card-button-click',
      elapsedMs: Date.now() - startedAt,
    },
  };
}
