import { useState, useRef, useCallback, useEffect } from 'react';
import { SyncDriver } from '../sync/sync-driver';
import { TranslateDriver } from '../translate/translate-driver';
import { SYNC_ACTION } from '../sync/sync-protocol';
import { WEBVIEW_PARTITION } from '../../../shared/constants/webview-partition';
import '../web.css';

declare const viewAPI: {
  sendToOtherSlot: (message: { protocol: string; action: string; payload: unknown }) => void;
  onMessage: (callback: (message: { protocol: string; action: string; payload: unknown }) => void) => () => void;
  closeSlot: () => Promise<void>;
  translateFetchElementJs: () => Promise<string | null>;
};

/**
 * TranslateWebView — 右侧翻译 WebView
 *
 * 通信协议见 slot-communication.md
 */
export function TranslateWebView() {
  const webviewRef = useRef<Electron.WebviewTag | null>(null);
  const syncDriverRef = useRef<SyncDriver | null>(null);
  const translateDriverRef = useRef(new TranslateDriver('zh-CN'));
  const remoteNavUntilRef = useRef(0);
  const [targetLang, setTargetLang] = useState('zh-CN');
  const initSentRef = useRef(false);

  // ── 消息监听（必须在 setupWebview 之前注册） ──
  useEffect(() => {
    const unsub = viewAPI.onMessage((msg) => {
      switch (msg.action) {
        case SYNC_ACTION.TAKE_CONTROL:
          syncDriverRef.current?.yield();
          break;

        case SYNC_ACTION.SYNC_EVENTS: {
          const p = msg.payload as { events: unknown[]; fromSide: 'left' | 'right' };
          syncDriverRef.current?.handleRemoteEvents(p.events as any, p.fromSide);
          break;
        }

        case SYNC_ACTION.NAVIGATE: {
          const url = (msg.payload as { url: string }).url;
          if (url && webviewRef.current) {
            remoteNavUntilRef.current = Date.now() + 2000;
            webviewRef.current.loadURL(url);
          }
          break;
        }
      }
    });
    return () => { unsub(); };
  }, []);

  // ── webview ref callback ──
  const setupWebview = useCallback((el: Electron.WebviewTag | null) => {
    if (!el || webviewRef.current === el) return;
    webviewRef.current = el;

    // SyncDriver（翻译注入期间跳过 poll）
    const td = translateDriverRef.current;
    const driver = new SyncDriver(
      'right',
      (msg) => viewAPI.sendToOtherSlot(msg),
      undefined,
      () => td.injecting,
    );
    driver.bind(el);
    syncDriverRef.current = driver;

    // did-finish-load：启动同步 + 异步注入翻译
    el.addEventListener('did-finish-load', () => {
      const url = el.getURL();
      if (!url || url === 'about:blank') return;

      driver.start();
      viewAPI.sendToOtherSlot({
        protocol: 'web-translate',
        action: SYNC_ACTION.READY,
        payload: {},
      });
      // 异步注入翻译（fire-and-forget，不阻塞同步）
      td.inject(el).catch(() => {});
    });

    // did-navigate：用户主动导航时 takeControl + 通知对面
    el.addEventListener('did-navigate', (e: any) => {
      driver.reinject();
      if (Date.now() < remoteNavUntilRef.current) {
        // 在时间窗口内，是对面触发的导航（含重定向），不回发
      } else {
        driver.takeControl();
        viewAPI.sendToOtherSlot({
          protocol: 'web-translate',
          action: SYNC_ACTION.NAVIGATE,
          payload: { url: e.url },
        });
      }
    });

    el.addEventListener('did-navigate-in-page', (e: any) => {
      driver.reinject();
      if (e.isMainFrame) {
        if (Date.now() < remoteNavUntilRef.current) {
          // 在时间窗口内，不回发
        } else {
          driver.takeControl();
          viewAPI.sendToOtherSlot({
            protocol: 'web-translate',
            action: SYNC_ACTION.NAVIGATE,
            payload: { url: e.url },
          });
        }
      }
    });

    // webview 就绪后发送 REQUEST_URL
    if (!initSentRef.current) {
      initSentRef.current = true;
      viewAPI.sendToOtherSlot({
        protocol: 'web-translate',
        action: SYNC_ACTION.REQUEST_URL,
        payload: {},
      });
    }
  }, []);

  // 语言变更
  useEffect(() => {
    translateDriverRef.current.setTargetLang(targetLang);
  }, [targetLang]);

  return (
    <div className="web-view">
      <div className="translate-toolbar">
        <select
          value={targetLang}
          onChange={(e) => setTargetLang(e.target.value)}
          className="translate-toolbar__lang-select"
        >
          <option value="zh-CN">中文</option>
          <option value="ja">日本語</option>
          <option value="ko">한국어</option>
          <option value="en">English</option>
          <option value="fr">Français</option>
          <option value="de">Deutsch</option>
          <option value="es">Español</option>
        </select>
        <button
          className="web-toolbar__btn web-toolbar__btn--close-slot"
          onClick={() => viewAPI.closeSlot()}
          title="关闭翻译"
        >
          ×
        </button>
      </div>
      <div className="web-view__content">
        <webview
          ref={setupWebview}
          src="about:blank"
          partition={WEBVIEW_PARTITION}
          // @ts-ignore — Electron webview attribute for CSP bypass
          disablewebsecurity="true"
          // @ts-ignore
          allowpopups="true"
          className="web-view__webview"
        />
      </div>
    </div>
  );
}
