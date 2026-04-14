// @ts-ignore — Vite ?raw import
import googleTranslateInjectRaw from './google-translate-inject.js?raw';

declare const viewAPI: {
  translateFetchElementJs: () => Promise<string | null>;
};

/**
 * TranslateDriver — renderer 侧的 Google Translate 注入引擎
 *
 * 注入策略：
 * - Step 1 (CSP) 立即执行
 * - Step 2 (fetch element.js) await IPC（安全）
 * - Step 3-5 顺序 fire-and-forget（通过 .then 链，不用 setTimeout）
 * - 每次 did-finish-load 触发新的 inject，旧的自然被页面导航中断
 */
export class TranslateDriver {
  private targetLang: string;
  injecting = false;
  private injectId = 0;  // 递增 ID，用于检测 inject 是否被新的覆盖

  constructor(targetLang = 'zh-CN') {
    this.targetLang = targetLang;
  }

  setTargetLang(lang: string): void {
    this.targetLang = lang;
  }

  async inject(webview: Electron.WebviewTag): Promise<void> {
    if (webview.isLoading()) return;

    const myId = ++this.injectId;
    this.injecting = true;

    // Step 1: 移除 CSP meta
    webview.executeJavaScript(`
      (function() {
        document.querySelectorAll('meta[http-equiv]').forEach(function(m) {
          if (/content-security-policy/i.test(m.getAttribute('http-equiv'))) m.remove();
        });
        new MutationObserver(function(mutations) {
          mutations.forEach(function(mut) {
            mut.addedNodes.forEach(function(node) {
              if (node.nodeName === 'META' &&
                  /content-security-policy/i.test(node.getAttribute('http-equiv') || ''))
                node.remove();
            });
          });
        }).observe(document.head || document.documentElement, { childList: true });
      })();
    `).catch(() => {});

    // Step 2: fetch element.js（IPC，安全 await）
    let elementJsCode: string | null = null;
    try {
      elementJsCode = await viewAPI.translateFetchElementJs();
    } catch {
      this.injecting = false;
      return;
    }
    if (!elementJsCode) {
      this.injecting = false;
      return;
    }

    // 检查：await 期间是否有新的 inject 被触发（页面导航了）
    if (this.injectId !== myId) {
      this.injecting = false;
      return;
    }

    // 检查 webview 是否仍在同一页面
    if (webview.isLoading()) {
      this.injecting = false;
      return;
    }

    // Step 3-5: 顺序注入（fire-and-forget .then 链）
    const script = (googleTranslateInjectRaw as string).replace('__KRIG_TARGET_LANG__', this.targetLang);

    webview.executeJavaScript(script).then(() => {
      // Step 4: 执行 element.js
      if (this.injectId !== myId) return;
      return webview.executeJavaScript(elementJsCode!);
    }).then(() => {
      // Step 5: 暗色模式
      if (this.injectId !== myId) return;
      return webview.executeJavaScript(`
        (function() {
          var meta = document.querySelector('meta[name="color-scheme"]');
          if (!meta) {
            meta = document.createElement('meta');
            meta.setAttribute('name', 'color-scheme');
            document.head.appendChild(meta);
          }
          meta.setAttribute('content', 'dark');
          document.documentElement.style.colorScheme = 'dark';
        })();
      `);
    }).then(() => {
      if (this.injectId === myId) this.injecting = false;
    }).catch(() => {
      if (this.injectId === myId) this.injecting = false;
    });
  }
}
