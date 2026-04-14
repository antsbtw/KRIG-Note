/**
 * web-content preload — 注入到 webview 标签内的网页中
 *
 * 职责：
 * - CSP bypass（移除 Content-Security-Policy meta 标签）
 *
 * 模块化结构，为 Batch 5 Automation Bridge 预留扩展位置。
 * 当前只包含 CSP bypass，不引入任何 Automation 代码。
 */

// ── CSP Bypass ──

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

// web:automation:* — Batch 5 Automation Bridge 扩展点
