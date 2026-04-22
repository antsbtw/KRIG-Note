import { useState, useRef, useCallback, useEffect } from 'react';
import { WebToolbar } from './WebToolbar';
import { SyncDriver } from '../sync/sync-driver';
import { SYNC_ACTION } from '../sync/sync-protocol';
import { getSSECaptureScript } from '../../web-bridge/injection/inject-scripts/sse-capture';
import { getAIServiceProfile, detectAIServiceByUrl } from '../../../shared/types/ai-service-types';
import type { AIServiceId } from '../../../shared/types/ai-service-types';
import { WEBVIEW_PARTITION } from '../../../shared/constants/webview-partition';
import { WebViewContextMenu } from '../context-menu';
import '../web.css';

declare const viewAPI: {
  webBookmarkAdd: (url: string, title: string, favicon?: string) => Promise<unknown>;
  webBookmarkRemove: (id: string) => Promise<void>;
  webBookmarkList: () => Promise<Array<{ id: string; url: string; title: string; favicon?: string; folderId: string | null; createdAt: number }>>;
  webBookmarkFindByUrl: (url: string) => Promise<{ id: string } | null>;
  webHistoryAdd: (url: string, title: string, favicon?: string) => Promise<unknown>;
  sendToOtherSlot: (message: { protocol: string; action: string; payload: unknown }) => void;
  onMessage: (callback: (message: { protocol: string; action: string; payload: unknown }) => void) => () => void;
  requestCompanion: (workModeId: string) => Promise<void>;
  translateText: (text: string, targetLang?: string) => Promise<{ text: string } | null>;
};

const DEFAULT_URL = 'https://www.google.com';

/**
 * WebView — L3 View 组件
 *
 * 通信协议见 slot-communication.md
 */
export function WebView() {
  const webviewRef = useRef<Electron.WebviewTag | null>(null);
  const syncDriverRef = useRef<SyncDriver | null>(null);
  const remoteNavUntilRef = useRef(0);  // 时间戳：在此之前的导航都是对面触发的，不回发
  const [currentUrl, setCurrentUrl] = useState(DEFAULT_URL);
  const [currentTitle, setCurrentTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const bookmarkIdRef = useRef<string | null>(null);

  // ── webview 事件绑定 ──

  const setupWebview = useCallback((el: Electron.WebviewTag | null) => {
    if (!el || webviewRef.current === el) return;
    webviewRef.current = el;

    // SyncDriver（左侧）— 带翻译回调用于 input-enter
    const driver = new SyncDriver(
      'left',
      (msg) => viewAPI.sendToOtherSlot(msg),
      async (value) => {
        const result = await viewAPI.translateText(value, 'en');
        return result?.text ?? null;
      },
    );
    driver.bind(el);
    syncDriverRef.current = driver;

    el.addEventListener('did-start-loading', () => setLoading(true));
    el.addEventListener('did-stop-loading', () => setLoading(false));

    el.addEventListener('did-navigate', (e: any) => {
      setCurrentUrl(e.url);
      setCanGoBack(el.canGoBack());
      setCanGoForward(el.canGoForward());
      checkBookmark(e.url);
      driver.reinject();
      // 区分：用户主动导航 vs 对面 NAVIGATE 消息触发的导航
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
      if (e.isMainFrame) {
        setCurrentUrl(e.url);
        setCanGoBack(el.canGoBack());
        setCanGoForward(el.canGoForward());
        checkBookmark(e.url);
        driver.reinject();
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

    el.addEventListener('page-title-updated', (e: any) => {
      setCurrentTitle(e.title);
      const url = el.getURL();
      if (url && !url.startsWith('about:') && e.title) {
        viewAPI.webHistoryAdd(url, e.title).catch(() => {});
      }
    });

    el.addEventListener('did-finish-load', () => {
      driver.reinject();
    });

  }, []);

  // ── 书签状态检查 ──

  const checkBookmark = useCallback(async (url: string) => {
    try {
      const found = await viewAPI.webBookmarkFindByUrl(url);
      setIsBookmarked(!!found);
      bookmarkIdRef.current = found?.id ?? null;
    } catch {
      setIsBookmarked(false);
      bookmarkIdRef.current = null;
    }
  }, []);

  useEffect(() => {
    checkBookmark(currentUrl);
  }, []);

  // ── 监听右侧消息（见 slot-communication.md） ──

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

        case SYNC_ACTION.REQUEST_URL: {
          // 右侧初始化请求 → 回复当前 URL（可能需要等 webview 就绪）
          const url = webviewRef.current?.getURL();
          if (url && url !== 'about:blank' && url !== '') {
            viewAPI.sendToOtherSlot({
              protocol: 'web-translate',
              action: SYNC_ACTION.NAVIGATE,
              payload: { url },
            });
          } else {
            // webview 还没导航完成，等 did-navigate 后回复
            const onNav = (e: any) => {
              viewAPI.sendToOtherSlot({
                protocol: 'web-translate',
                action: SYNC_ACTION.NAVIGATE,
                payload: { url: e.url },
              });
              webviewRef.current?.removeEventListener('did-navigate', onNav);
            };
            webviewRef.current?.addEventListener('did-navigate', onNav);
          }
          break;
        }

        case SYNC_ACTION.READY:
          syncDriverRef.current?.start();
          break;
      }
    });
    return () => { unsub(); };
  }, []);

  // ── Toolbar 回调 ──

  const handleNavigate = useCallback((url: string) => {
    const webview = webviewRef.current;
    if (!webview) return;

    let finalUrl = url.trim();
    if (!finalUrl) return;

    if (!finalUrl.includes('://') && !finalUrl.includes('.')) {
      finalUrl = `https://www.google.com/search?q=${encodeURIComponent(finalUrl)}`;
    } else if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      finalUrl = `https://${finalUrl}`;
    }

    webview.loadURL(finalUrl);
  }, []);

  const handleGoBack = useCallback(() => webviewRef.current?.goBack(), []);
  const handleGoForward = useCallback(() => webviewRef.current?.goForward(), []);
  const handleReload = useCallback(() => webviewRef.current?.reload(), []);

  const handleBookmarkToggle = useCallback(async () => {
    if (isBookmarked && bookmarkIdRef.current) {
      await viewAPI.webBookmarkRemove(bookmarkIdRef.current);
      setIsBookmarked(false);
      bookmarkIdRef.current = null;
    } else {
      const result = await viewAPI.webBookmarkAdd(currentUrl, currentTitle || currentUrl) as any;
      setIsBookmarked(true);
      bookmarkIdRef.current = result?.id ?? null;
    }
  }, [isBookmarked, currentUrl, currentTitle]);

  // ── AI Workflow: handle AI inject-and-send from main process ──
  // When NoteView asks AI, main opens this WebView in Right Slot,
  // then sends AI_INJECT_AND_SEND. We navigate to AI, inject SSE, paste, send, capture.
  // User watches the entire AI interaction in real time.
  useEffect(() => {
    const unsub = (viewAPI as any).onAIInjectAndSend?.(async (params: {
      serviceId: string; prompt: string; noteId: string; thoughtId: string; responseChannel: string;
    }) => {
      // Wait for webview element to be available (may not be mounted yet)
      let webview = webviewRef.current;
      for (let attempt = 0; attempt < 10 && !webview; attempt++) {
        await new Promise(r => setTimeout(r, 300));
        webview = webviewRef.current;
      }
      if (!webview) {
        (viewAPI as any).aiSendResponse(params.responseChannel, { success: false, error: 'Webview not ready after 3s' });
        return;
      }

      try {
        const profile = getAIServiceProfile(params.serviceId as AIServiceId);

        // 1. Navigate to AI service
        // Always navigate — this is a fresh WebView showing google.com
        console.log(`[AI WebView] Navigating to ${profile.newChatUrl}`);
        webview.loadURL(profile.newChatUrl);
        setCurrentUrl(profile.newChatUrl);
        setCurrentTitle(profile.name);

        // Wait for AI page to fully load
        await new Promise<void>((resolve) => {
          const onLoad = () => { webview!.removeEventListener('did-finish-load', onLoad); resolve(); };
          webview!.addEventListener('did-finish-load', onLoad);
        });
        // Extra time for SPA frameworks to hydrate (React/Angular/etc.)
        console.log(`[AI WebView] Page loaded, waiting for SPA hydration...`);
        await new Promise(r => setTimeout(r, 3000));

        // 2. Inject SSE capture
        console.log(`[AI WebView] Injecting SSE capture for ${profile.id}`);
        const sseScript = getSSECaptureScript(profile.id, profile.intercept.endpointPattern);
        const hookResult = await webview.executeJavaScript(sseScript);
        console.log(`[AI WebView] SSE hook result: ${hookResult}`);
        await webview.executeJavaScript('window.__krig_sse_responses = [];');

        // 3. Paste prompt
        const escaped = params.prompt.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
        await webview.executeJavaScript(`(function() {
          var selector = ${JSON.stringify(profile.selectors.inputBox)};
          var selectors = selector.split(',').map(function(s) { return s.trim(); });
          var el = null;
          for (var i = 0; i < selectors.length; i++) { el = document.querySelector(selectors[i]); if (el) break; }
          if (!el) return;
          el.focus();
          if (el.contentEditable === 'true') {
            var dt = new DataTransfer();
            dt.setData('text/plain', \`${escaped}\`);
            el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
            setTimeout(function() {
              if (el.textContent.trim().length === 0) {
                el.innerHTML = '<p>' + \`${escaped}\`.replace(/\\n/g, '</p><p>') + '</p>';
                el.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }, 200);
          } else {
            el.value = \`${escaped}\`;
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        })()`);

        // 4. Click send
        await new Promise(r => setTimeout(r, 500));
        await webview.executeJavaScript(`(function() {
          var selector = ${JSON.stringify(profile.selectors.sendButton)};
          var selectors = selector.split(',').map(function(s) { return s.trim(); });
          var btn = null;
          for (var i = 0; i < selectors.length; i++) { btn = document.querySelector(selectors[i]); if (btn && !btn.disabled) break; btn = null; }
          if (btn) btn.click();
        })()`);

        // 5. Poll for SSE response (user watches AI reply in real time)
        console.log(`[AI WebView] Polling for SSE response...`);
        const startTime = Date.now();
        while (Date.now() - startTime < 90_000) {
          await new Promise(r => setTimeout(r, 1000));
          const status = await webview.executeJavaScript(`(function() {
            var r = window.__krig_sse_responses || [];
            var l = r.length > 0 ? r[r.length - 1] : null;
            return { count: r.length, latestStreaming: l ? l.streaming : false, hooked: !!window.__krig_sse_hooked };
          })()`);

          // Log every 5 seconds
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          if (elapsed % 5 === 0) {
            console.log(`[AI WebView] Poll ${elapsed}s: responses=${status.count}, streaming=${status.latestStreaming}, hooked=${status.hooked}`);
          }

          if (status.count > 0 && !status.latestStreaming) {
            const markdown = await webview.executeJavaScript(`(function() {
              var r = window.__krig_sse_responses || [];
              for (var i = r.length - 1; i >= 0; i--) { if (!r[i].streaming && r[i].markdown.length > 0) return r[i].markdown; }
              return null;
            })()`);
            (viewAPI as any).aiSendResponse(params.responseChannel, { success: true, markdown });
            return;
          }
        }
        (viewAPI as any).aiSendResponse(params.responseChannel, { success: false, error: 'AI response timed out' });
      } catch (err) {
        (viewAPI as any).aiSendResponse(params.responseChannel, { success: false, error: String(err) });
      }
    });

    return () => { if (unsub) unsub(); };
  }, []);

  return (
    <div className="web-view">
      <WebToolbar
        url={currentUrl}
        loading={loading}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        isBookmarked={isBookmarked}
        onNavigate={handleNavigate}
        onGoBack={handleGoBack}
        onGoForward={handleGoForward}
        onReload={handleReload}
        onBookmarkToggle={handleBookmarkToggle}
        onCloseSlot={() => (viewAPI as any).closeSelf()}
      />
      <div className="web-view__content" style={{ position: 'relative' }}>
        <webview
          ref={setupWebview}
          src={DEFAULT_URL}
          className="web-view__webview"
          partition={WEBVIEW_PARTITION}
          // @ts-ignore
          allowpopups="true"
        />
        <WebViewContextMenu webviewRef={webviewRef} />
      </div>
    </div>
  );
}
