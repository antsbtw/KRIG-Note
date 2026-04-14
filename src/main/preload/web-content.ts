/**
 * WebView Guest Preload — context-menu signal
 *
 * Runs inside every `<webview>` guest page (attached via
 * did-attach-webview in shell.ts). Because it is a Chromium preload
 * script it is re-injected on *every* document load, including SPA
 * route changes that replace the document object. This is the ONLY
 * reliable way to keep our context-menu listener alive across all
 * AI site navigations; `webview.executeJavaScript` from the host
 * cannot do that because it fires only when the host observes
 * navigation events.
 *
 * Responsibilities:
 *   1. CSP bypass (strip meta[http-equiv=Content-Security-Policy])
 *   2. Right-click signal: forward viewport coordinates + a compact
 *      target descriptor to the host via ipcRenderer.sendToHost.
 *
 * The preload is intentionally business-agnostic. It neither renders
 * the menu nor knows about AI-specific selectors. The host-side
 * registry (see src/plugins/web/context-menu) decides what items to
 * show and when.
 *
 * Host channel:
 *   'krig:context-menu' → { x, y, targetTag, targetHtml }
 */

import { ipcRenderer } from 'electron';

// ─── CSP bypass (kept from prior version) ───────────────────────────
new MutationObserver((mutations) => {
  for (const { addedNodes } of mutations) {
    for (const node of addedNodes) {
      if (
        node instanceof HTMLElement &&
        node.nodeName === 'META' &&
        (node as HTMLMetaElement).httpEquiv?.toLowerCase() === 'content-security-policy'
      ) {
        node.remove();
      }
    }
  }
}).observe(document.head ?? document.documentElement, { childList: true });

// ─── Context-menu signal ────────────────────────────────────────────
//
// Listen on document at capture phase for contextmenu, pointerdown,
// and mousedown (button === 2). Using all three gives us a reliable
// fall-through for sites that preventDefault on contextmenu (e.g. the
// ChatGPT DALL·E image wrapper). Once any of them fires we report
// once and suppress the trailing contextmenu so the native menu
// doesn't race the custom one.

let suppressNext = false;

function report(ev: MouseEvent | PointerEvent): void {
  // Skip editable regions — the user almost certainly wants the native
  // input menu (spellcheck / select-all / cut / paste).
  let t: HTMLElement | null = ev.target as HTMLElement | null;
  while (t && t !== document.body) {
    if (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
    t = t.parentElement;
  }

  ev.preventDefault();
  ev.stopPropagation();

  const target = ev.target as HTMLElement | null;
  const outer = target?.outerHTML?.slice(0, 200) ?? '';

  try {
    ipcRenderer.sendToHost('krig:context-menu', {
      x: ev.clientX,
      y: ev.clientY,
      targetTag: target?.tagName ?? null,
      targetHtml: outer,
    });
  } catch {
    /* ignore — host may not be ready yet */
  }
}

document.addEventListener('contextmenu', (ev) => {
  if (suppressNext) {
    suppressNext = false;
    ev.preventDefault();
    return;
  }
  report(ev);
}, true);

document.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 2) return;
  report(ev);
  suppressNext = true;
}, true);

document.addEventListener('mousedown', (ev) => {
  if (ev.button !== 2) return;
  report(ev);
  suppressNext = true;
}, true);
