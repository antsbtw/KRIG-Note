import type { WebContents } from 'electron';

/**
 * 拦截 HTTP 响应头，移除 CSP — 允许 Google Translate 脚本注入。
 *
 * 仅对指定 webContents 的请求生效（通过 webContentsId 过滤），
 * 不影响同 partition 下其他 webview（如左侧原文浏览器）。
 * 通过 onViewCreated 钩子调用，与 setupExtractionInterceptor 同一模式。
 */
export function setupCSPBypass(guestWebContents: WebContents): void {
  const targetId = guestWebContents.id;
  console.log(`[CSPBypass] Setup for webContentsId=${targetId}`);

  guestWebContents.session.webRequest.onHeadersReceived(
    { urls: ['*://*/*'] },
    (details, callback) => {
      const reqWcId = (details as any).webContentsId;
      if (reqWcId === targetId) {
        // 翻译 webview 的请求 → 移除 CSP
        const headers = { ...details.responseHeaders };
        delete headers['content-security-policy'];
        delete headers['Content-Security-Policy'];
        delete headers['content-security-policy-report-only'];
        delete headers['Content-Security-Policy-Report-Only'];
        callback({ responseHeaders: headers });
      } else {
        // 其他 webview → 不修改
        callback({});
      }
    },
  );
}
