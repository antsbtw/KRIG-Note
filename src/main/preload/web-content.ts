/**
 * WebView Guest Preload
 *
 * Runs inside every <webview> guest page (attached via
 * will-attach-webview in shell.ts). Re-injected on every document
 * load — including SPA navigations and cross-origin iframes — by
 * Chromium itself.
 *
 * Responsibilities:
 *   1. CSP bypass (strip meta[http-equiv=Content-Security-Policy]).
 *
 * NOT responsible for context-menu handling: right-click is captured
 * one layer up by Chromium and forwarded by the main process via
 * `webContents.on('context-menu')`. That path covers cross-origin
 * iframes too, which guest-side JS cannot reach.
 */

// Preload runs before the document exists in some sandboxed cases, so
// defer observer setup until DOMContentLoaded. Without this guard the
// preload throws a TypeError on `observe(null, ...)` and Chromium
// silently drops the rest of the script.
function installCspBypass(): void {
  const root = document.head ?? document.documentElement;
  if (!root) return;
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
  }).observe(root, { childList: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installCspBypass, { once: true });
} else {
  installCspBypass();
}
