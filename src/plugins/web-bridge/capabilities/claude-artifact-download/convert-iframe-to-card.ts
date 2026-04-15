/**
 * convert-iframe-to-card.ts
 *
 * "Save as artifact" menu item (row 3) — converts an inline iframe
 * artifact into a new Code·HTML card in the Claude conversation. This
 * is the ONLY path that yields the artifact's real HTML source code
 * for the caller to inspect.
 *
 * SIDE EFFECT: The new card is permanent in the user's Claude
 * conversation. This MUST NOT be used in a conversation the user can
 * see — it pollutes their chat with copies they never asked for.
 *
 * Intended caller: Module 5 (KRIG's built-in Gemma / background AI)
 * operating in a hidden webview. When the hidden webview is destroyed,
 * the pollution goes with it.
 *
 * See Artifact-Download-Module.md §11 for the full discussion.
 */

import { CDP_TIMINGS } from './claude-ui-constants';
import { ClaudeArtifactDownloadError, type ClaudeArtifactRef } from './types';

export interface ConvertIframeToCardResult {
  /** Ordinal of the new card (always appended at the end of merged list). */
  newOrdinal: number;
  /** Count of card-form artifacts before conversion. */
  preExistingCardCount: number;
}

interface ViewAPIConvert {
  wbSendMouse: (events: Array<{
    type: string; x: number; y: number;
    button?: string; buttons?: number; clickCount?: number;
  }>) => Promise<{ success: boolean; error?: string; count?: number }>;
}

/**
 * Trigger "Save as artifact" on an iframe-form artifact and wait for
 * the new card to appear in the DOM.
 *
 * @param webview webview hosting the Claude conversation (MUST be hidden)
 * @param view renderer-side viewAPI with CDP mouse
 * @param ref only `ordinal` is supported (DOM refs can't cross executeJavaScript)
 * @param opts.timeout max wait for new card (default 5s)
 */
export async function convertIframeToCardInClaude(
  webview: Electron.WebviewTag,
  view: ViewAPIConvert,
  ref: ClaudeArtifactRef,
  opts?: { timeout?: number },
): Promise<ConvertIframeToCardResult> {
  if (ref.cardEl !== undefined || ref.iframeEl !== undefined) {
    throw new ClaudeArtifactDownloadError('no-such-artifact', {
      reason: 'cardEl/iframeEl refs cannot cross executeJavaScript boundary; use ordinal',
    });
  }
  if (typeof ref.ordinal !== 'number') {
    throw new ClaudeArtifactDownloadError('no-such-artifact', { reason: 'ordinal required' });
  }

  const timeout = opts?.timeout ?? 5_000;

  // Resolve and scroll the iframe.
  const resolveScript = `
    (async function() {
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
      var entry = merged[${ref.ordinal}];
      if (!entry) return { err: 'no-such-artifact', totalFound: merged.length };
      if (entry.form !== 'iframe') return { err: 'wrong-form', actual: entry.form };

      var iframe = entry.el;
      var card = iframe;
      for (var k = 0; k < 3 && card.parentElement; k++) card = card.parentElement;
      card.scrollIntoView({ block: 'center', behavior: 'instant' });
      await new Promise(function(r) { setTimeout(r, 400); });
      var r = card.getBoundingClientRect();
      return {
        preCardCount: cards.length,
        trX: Math.round(r.x + r.width - 30),
        trY: Math.round(r.y + 30),
        cx: Math.round(r.x + r.width / 2),
        cy: Math.round(r.y + r.height / 2),
      };
    })()
  `;
  const anchor = await webview.executeJavaScript(resolveScript);
  if (!anchor) throw new ClaudeArtifactDownloadError('no-such-artifact', { ordinal: ref.ordinal });
  if (anchor.err === 'no-such-artifact') {
    throw new ClaudeArtifactDownloadError('no-such-artifact', { ordinal: ref.ordinal, totalFound: anchor.totalFound });
  }
  if (anchor.err === 'wrong-form') {
    throw new ClaudeArtifactDownloadError('wrong-form', { expected: 'iframe', actual: anchor.actual });
  }

  // CDP hover + click "Save as artifact" (menu row 3).
  const moveOk = await view.wbSendMouse([
    { type: 'mouseMoved', x: anchor.cx - 400, y: anchor.cy, button: 'none', buttons: 0 },
    { type: 'mouseMoved', x: anchor.cx, y: anchor.cy, button: 'none', buttons: 0 },
    { type: 'mouseMoved', x: anchor.trX, y: anchor.trY, button: 'none', buttons: 0 },
  ]);
  if (!moveOk.success) {
    throw new ClaudeArtifactDownloadError('cdp-menu-failed', { reason: 'hover failed: ' + moveOk.error });
  }
  await sleep(CDP_TIMINGS.hoverToMenuOpenMs);

  // "Save as artifact" offsets from MENU_OFFSETS.saveAsArtifact
  const itemX = anchor.trX - 80;
  const itemY = anchor.trY + 117;
  await view.wbSendMouse([{ type: 'mouseMoved', x: itemX, y: itemY, button: 'none', buttons: 0 }]);
  await sleep(CDP_TIMINGS.menuItemHoverToClickMs);
  await view.wbSendMouse([
    { type: 'mousePressed', x: itemX, y: itemY, button: 'left', buttons: 1, clickCount: 1 },
    { type: 'mouseReleased', x: itemX, y: itemY, button: 'left', buttons: 0, clickCount: 1 },
  ]);
  // Reset mouse so it doesn't linger.
  await view.wbSendMouse([{ type: 'mouseMoved', x: 5, y: 5, button: 'none', buttons: 0 }]);

  // Wait for the new card to appear.
  const preCardCount: number = anchor.preCardCount;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const n = await webview.executeJavaScript(
      'document.querySelectorAll(\'[class*="group/artifact-block"]\').length',
    ).catch(() => preCardCount);
    if (typeof n === 'number' && n > preCardCount) {
      // New ordinal = end of merged list. After conversion, the old
      // iframe may still be in DOM; caller shouldn't rely on old
      // ordinals — they should re-scan via listAllArtifacts.
      return { newOrdinal: -1, preExistingCardCount: preCardCount };
    }
    await sleep(100);
  }
  throw new ClaudeArtifactDownloadError('cdp-menu-failed', { reason: 'new card did not appear within timeout' });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
