import { useState, useRef, useCallback, useEffect } from 'react';
import { getSSECaptureScript } from '../../../shared/ai/sse-capture-script';
import { getAIServiceProfile, getAIServiceList, DEFAULT_AI_SERVICE, detectAIServiceByUrl } from '../../../shared/types/ai-service-types';
import type { AIServiceId } from '../../../shared/types/ai-service-types';
import '../web.css';

declare const viewAPI: {
  sendToOtherSlot: (message: { protocol: string; action: string; payload: unknown }) => void;
  onMessage: (callback: (message: { protocol: string; action: string; payload: unknown }) => void) => () => void;
  onAIInjectAndSend?: (callback: (params: any) => void) => () => void;
  aiSendResponse?: (channel: string, result: any) => Promise<void>;
  closeSlot: () => void;
};

/**
 * AIWebView — AI 专用 WebView 变体
 *
 * 与普通 WebView 的区别：
 * - 无地址栏输入（AI 服务 URL 固定）
 * - 简化 toolbar（服务名 + 状态 + 关闭）
 * - 支持 AI_INJECT_AND_SEND IPC 消息
 * - 保持 AI 页面的登录状态和对话历史
 */
export function AIWebView() {
  const webviewRef = useRef<Electron.WebviewTag | null>(null);
  const [currentService, setCurrentService] = useState<AIServiceId>(DEFAULT_AI_SERVICE);
  const [currentUrl, setCurrentUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [showServiceMenu, setShowServiceMenu] = useState(false);
  const [aiStatus, setAiStatus] = useState<'idle' | 'injecting' | 'waiting' | 'capturing'>('idle');
  const menuRef = useRef<HTMLDivElement>(null);

  const initialUrl = getAIServiceProfile(DEFAULT_AI_SERVICE).newChatUrl;

  // ── webview 事件绑定 ──
  const setupWebview = useCallback((el: Electron.WebviewTag | null) => {
    if (!el || webviewRef.current === el) return;
    webviewRef.current = el;

    el.addEventListener('did-start-loading', () => setLoading(true));
    el.addEventListener('did-stop-loading', () => setLoading(false));
    el.addEventListener('did-navigate', (_e: any) => {
      setCurrentUrl(el.getURL());
      const detected = detectAIServiceByUrl(el.getURL());
      if (detected) setCurrentService(detected.id);
    });
    el.addEventListener('did-navigate-in-page', () => {
      setCurrentUrl(el.getURL());
    });

    setCurrentUrl(initialUrl);
  }, [initialUrl]);

  // ── 切换 AI 服务 ──
  const switchService = useCallback((serviceId: AIServiceId) => {
    const webview = webviewRef.current;
    if (!webview) return;
    const profile = getAIServiceProfile(serviceId);
    webview.loadURL(profile.newChatUrl);
    setCurrentService(serviceId);
    setCurrentUrl(profile.newChatUrl);
    setShowServiceMenu(false);
  }, []);

  // ── 点击外部关闭菜单 ──
  useEffect(() => {
    if (!showServiceMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowServiceMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showServiceMenu]);

  // ── AI Workflow: handle AI_INJECT_AND_SEND ──
  useEffect(() => {
    const unsub = viewAPI.onAIInjectAndSend?.(async (params: {
      serviceId: string; prompt: string; noteId: string; thoughtId: string; responseChannel: string;
    }) => {
      let webview = webviewRef.current;
      // Wait for webview to be ready
      for (let i = 0; i < 10 && !webview; i++) {
        await new Promise(r => setTimeout(r, 300));
        webview = webviewRef.current;
      }
      if (!webview) {
        viewAPI.aiSendResponse?.(params.responseChannel, { success: false, error: 'AI Webview not ready' });
        return;
      }

      try {
        const profile = getAIServiceProfile(params.serviceId as AIServiceId);

        // 1. Navigate to AI service if not already there
        const curUrl = webview.getURL?.() || '';
        if (!new RegExp(profile.urlPattern).test(curUrl)) {
          setAiStatus('injecting');
          console.log(`[AIWebView] Navigating to ${profile.newChatUrl}`);
          webview.loadURL(profile.newChatUrl);
          setCurrentService(params.serviceId as AIServiceId);

          await new Promise<void>((resolve) => {
            const onLoad = () => { webview!.removeEventListener('did-finish-load', onLoad); resolve(); };
            webview!.addEventListener('did-finish-load', onLoad);
          });
          // SPA hydration
          await new Promise(r => setTimeout(r, 3000));
        }

        // 2. Inject SSE capture
        setAiStatus('injecting');
        const sseScript = getSSECaptureScript(profile.id, profile.intercept.endpointPattern);
        const hookResult = await webview.executeJavaScript(sseScript);
        console.log(`[AIWebView] SSE hook: ${hookResult}`);
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

        // 5. Poll for response
        setAiStatus('waiting');
        console.log(`[AIWebView] Waiting for AI response...`);
        const startTime = Date.now();
        while (Date.now() - startTime < 90_000) {
          await new Promise(r => setTimeout(r, 1000));
          const status = await webview.executeJavaScript(`(function() {
            var r = window.__krig_sse_responses || [];
            var l = r.length > 0 ? r[r.length - 1] : null;
            return { count: r.length, streaming: l ? l.streaming : false, hooked: !!window.__krig_sse_hooked };
          })()`);

          const elapsed = Math.round((Date.now() - startTime) / 1000);
          if (elapsed % 5 === 0) {
            console.log(`[AIWebView] Poll ${elapsed}s: responses=${status.count}, streaming=${status.streaming}, hooked=${status.hooked}`);
          }

          if (status.count > 0 && !status.streaming) {
            setAiStatus('capturing');
            const markdown = await webview.executeJavaScript(`(function() {
              var r = window.__krig_sse_responses || [];
              for (var i = r.length - 1; i >= 0; i--) { if (!r[i].streaming && r[i].markdown.length > 0) return r[i].markdown; }
              return null;
            })()`);
            console.log(`[AIWebView] Captured response: ${markdown?.length ?? 0} chars`);
            setAiStatus('idle');
            viewAPI.aiSendResponse?.(params.responseChannel, { success: true, markdown });
            return;
          }
        }
        setAiStatus('idle');
        viewAPI.aiSendResponse?.(params.responseChannel, { success: false, error: 'AI response timed out' });
      } catch (err) {
        setAiStatus('idle');
        console.error('[AIWebView] Error:', err);
        viewAPI.aiSendResponse?.(params.responseChannel, { success: false, error: String(err) });
      }
    });

    return () => { if (unsub) unsub(); };
  }, []);

  const services = getAIServiceList();
  const currentProfile = getAIServiceProfile(currentService);

  const statusText = aiStatus === 'idle' ? '' :
    aiStatus === 'injecting' ? '注入中...' :
    aiStatus === 'waiting' ? 'AI 回复中...' :
    '提取中...';

  return (
    <div className="web-view">
      {/* AI Toolbar — 简化版，无地址栏 */}
      <div className="web-toolbar" style={{ display: 'flex', alignItems: 'center', padding: '4px 8px', gap: 8 }}>
        {/* Service selector */}
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            style={{
              background: '#333', border: '1px solid #555', borderRadius: 6,
              color: '#e8eaed', fontSize: 13, padding: '4px 12px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
            onClick={() => setShowServiceMenu(!showServiceMenu)}
          >
            <span>{currentProfile.icon}</span>
            <span>{currentProfile.name}</span>
            <span style={{ fontSize: 10, color: '#888' }}>▾</span>
          </button>
          {showServiceMenu && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 4,
              background: '#2a2a2a', border: '1px solid #444', borderRadius: 8,
              padding: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.4)', minWidth: 130, zIndex: 1000,
            }}>
              {services.map(s => (
                <button
                  key={s.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    padding: '6px 12px', background: s.id === currentService ? '#3a3a3a' : 'transparent',
                    border: 'none', color: '#e8eaed', fontSize: 13, cursor: 'pointer', borderRadius: 4,
                  }}
                  onClick={() => switchService(s.id as AIServiceId)}
                >
                  <span>{s.icon}</span> {s.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Loading / AI status */}
        {loading && <span style={{ color: '#888', fontSize: 12 }}>加载中...</span>}
        {statusText && (
          <span style={{ color: '#6366f1', fontSize: 12, fontWeight: 500 }}>{statusText}</span>
        )}

        <div style={{ flex: 1 }} />

        {/* Reload */}
        <button
          style={{ background: 'transparent', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 14 }}
          onClick={() => webviewRef.current?.reload()}
          title="刷新"
        >
          ↻
        </button>

        {/* Close */}
        <button
          style={{ background: 'transparent', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 16 }}
          onClick={() => viewAPI.closeSlot()}
          title="关闭"
        >
          ×
        </button>
      </div>

      {/* AI webview content */}
      <div className="web-view__content">
        <webview
          ref={setupWebview}
          src={initialUrl}
          className="web-view__webview"
          partition="persist:web"
          // @ts-ignore
          allowpopups="true"
        />
      </div>
    </div>
  );
}
