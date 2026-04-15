import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { getSSECaptureScript } from '../../web-bridge/injection/inject-scripts/sse-capture';
import { getArtifactPostMessageHookScript } from '../../web-bridge/injection/inject-scripts/artifact-postmessage-hook';
import { getDomToMarkdownScript } from '../../web-bridge/injection/inject-scripts/dom-to-markdown';
import { SlotToggle } from '../../../shared/components/SlotToggle';
import { WebViewContextMenu, type ContextMenuItem, type MenuContext } from '../context-menu';
import { extractClaudeConversation } from '../../web-bridge/capabilities/claude-api-extractor';
import { extractContent as extractChatGPTContent } from '../../web-bridge/capabilities/chatgpt-content-extractor';
import { extractContent as extractGeminiContent } from '../../web-bridge/capabilities/gemini-content-extractor';
import {
  getAIServiceProfile,
  getAIServiceList,
  DEFAULT_AI_SERVICE,
  detectAIServiceByUrl,
} from '../../../shared/types/ai-service-types';
import type { AIServiceId } from '../../../shared/types/ai-service-types';
import { processClaudeArtifactsFull, startSseTrigger } from '../../ai-note-bridge';
import '../web.css';

declare const viewAPI: {
  sendToOtherSlot: (message: { protocol: string; action: string; payload: unknown }) => void;
  onMessage: (callback: (message: { protocol: string; action: string; payload: unknown }) => void) => () => void;
  ensureRightSlot: (workModeId: string) => Promise<void>;
  noteCreate: (title?: string) => Promise<{ id: string; title: string } | null>;
  noteOpenInEditor: (id: string) => Promise<void>;
  noteLoad: (id: string) => Promise<{ id: string; title: string; doc_content: unknown[] } | null>;
  noteList: () => Promise<Array<{ id: string; title: string; folder_id: string | null; updated_at: number }>>;
  getActiveNoteId: () => Promise<string | null>;
  onAIInjectAndSend?: (callback: (params: any) => void) => () => void;
  aiSendResponse?: (channel: string, result: any) => Promise<void>;
  aiReadClipboard: () => Promise<string>;
  wbCdpStart: (urlFilters?: string[]) => Promise<{ success: boolean; error?: string; guestUrl?: string; guestId?: number; filters?: string[] }>;
  wbCdpStop: () => Promise<{ success: boolean }>;
  wbCdpFindResponse: (params: { urlSubstring: string; mode?: 'all' | 'latest' | 'first' }) =>
    Promise<{ success: boolean; error?: string; count?: number; matches?: Array<{ url: string; statusCode: number; mimeType: string; body: string | null; bodyLength: number; timestamp: number }> }>;
  wbSendMouse: (events: Array<{ type: string; x: number; y: number; button?: string; buttons?: number; clickCount?: number }>) =>
    Promise<{ success: boolean; error?: string; count?: number }>;
  wbReadClipboardImage: () =>
    Promise<{ success: boolean; empty?: boolean; dataUrl?: string; width?: number; height?: number }>;
  wbFetchBinary: (params: { url: string; headers?: Record<string, string>; timeoutMs?: number }) =>
    Promise<{ success: boolean; base64?: string; mimeType?: string; bodyLength?: number; error?: string }>;
  closeSlot: () => void;
};

/**
 * AIWebView — AI-specialized variant of WebView.
 *
 * Differences from the generic WebView:
 *   - No URL bar (services have fixed entry URLs).
 *   - Service selector dropdown for Claude / ChatGPT / Gemini.
 *   - Persists last-used service across sessions.
 *   - Right-click "提取到笔记" item via the shared context-menu registry.
 *   - Bridges AI_INJECT_AND_SEND IPC for the legacy NoteView "ask AI" flow.
 *
 * Sync engine, save-to-note button, and other AI↔Note behavior live in
 * the dedicated `plugins/ai-note-bridge` module.
 */
interface AIWebViewProps {
  workModeId?: string;
}

const LAST_SERVICE_KEY = 'krig.ai.lastService';

/** Read the last-used AI service from localStorage; fall back to default if missing/invalid. */
function loadLastService(): AIServiceId {
  try {
    const stored = localStorage.getItem(LAST_SERVICE_KEY);
    if (stored && getAIServiceList().some(s => s.id === stored)) {
      return stored as AIServiceId;
    }
  } catch {}
  return DEFAULT_AI_SERVICE;
}

export function AIWebView({ workModeId: _workModeId = '' }: AIWebViewProps) {
  void _workModeId; // workModeId is kept for prop-API stability; not used yet.
  const webviewRef = useRef<Electron.WebviewTag | null>(null);
  const [currentService, setCurrentService] = useState<AIServiceId>(loadLastService);
  const [loading, setLoading] = useState(true);
  const [showServiceMenu, setShowServiceMenu] = useState(false);
  const [aiStatus, setAiStatus] = useState<'idle' | 'injecting' | 'waiting' | 'capturing'>('idle');
  const menuRef = useRef<HTMLDivElement>(null);

  const initialUrl = getAIServiceProfile(currentService).newChatUrl;

  // ── webview lifecycle ──
  const setupWebview = useCallback((el: Electron.WebviewTag | null) => {
    if (!el || webviewRef.current === el) return;
    webviewRef.current = el;

    el.addEventListener('did-start-loading', () => setLoading(true));
    el.addEventListener('did-stop-loading', () => setLoading(false));

    // Install Claude's postMessage hook so artifact source captures
    // can be read later by the save-to-note path.
    const injectArtifactHookIfClaude = () => {
      try {
        const u = el.getURL?.() || '';
        if (u.indexOf('claude.ai') !== -1) {
          el.executeJavaScript(getArtifactPostMessageHookScript()).catch(() => {});
        }
      } catch {}
    };

    el.addEventListener('did-navigate', (_e: any) => {
      const detected = detectAIServiceByUrl(el.getURL());
      if (detected) {
        setCurrentService(detected.id);
        try { localStorage.setItem(LAST_SERVICE_KEY, detected.id); } catch {}
      }
      injectArtifactHookIfClaude();
    });
    el.addEventListener('did-navigate-in-page', injectArtifactHookIfClaude);
    el.addEventListener('dom-ready', injectArtifactHookIfClaude);
  }, []);

  // ── Service switch (dropdown) ──
  const switchService = useCallback((serviceId: AIServiceId) => {
    const webview = webviewRef.current;
    if (!webview) return;
    const profile = getAIServiceProfile(serviceId);
    webview.loadURL(profile.newChatUrl);
    setCurrentService(serviceId);
    setShowServiceMenu(false);
    try { localStorage.setItem(LAST_SERVICE_KEY, serviceId); } catch {}
  }, []);

  // ── Right-click "提取到笔记" item ──
  // Resolve the assistantMessage index at the click coordinates by
  // asking the guest page itself (elementFromPoint + closest).
  const resolveMsgIndex = useCallback(async (
    webview: Electron.WebviewTag,
    x: number,
    y: number,
    assistantSelector: string,
  ): Promise<number> => {
    const script = `(function() {
      var sel = ${JSON.stringify(assistantSelector)};
      var parts = sel.split(',').map(function(s) { return s.trim(); });
      var el = document.elementFromPoint(${x}, ${y});
      var hit = null;
      for (var i = 0; i < parts.length && !hit; i++) {
        hit = el && el.closest ? el.closest(parts[i]) : null;
      }
      if (!hit) return -1;
      var list = [];
      for (var j = 0; j < parts.length; j++) {
        var nodes = document.querySelectorAll(parts[j]);
        for (var k = 0; k < nodes.length; k++) list.push(nodes[k]);
      }
      return list.indexOf(hit);
    })()`;
    try {
      const r = await webview.executeJavaScript(script);
      return typeof r === 'number' ? r : -1;
    } catch {
      return -1;
    }
  }, []);

  const cdpStartedRef = useRef(false);

  /**
   * Extract one assistant turn (by DOM index) and emit it as
   * as:append-turn so NoteView inserts it. Mirrors the save-to-note
   * pipeline but for a single user-chosen turn.
   */
  const extractTurnAt = useCallback(async (ctx: MenuContext, msgIndex: number) => {
    const webview = ctx.webview;
    const url = ctx.url;
    const profile = detectAIServiceByUrl(url);
    if (!profile) return;

    try {
      await viewAPI.ensureRightSlot('demo-a');

      // ChatGPT / Gemini need CDP to see the conversation API response.
      // First-time only — reload with cache bypass so estuary image
      // bytes get captured.
      if ((profile.id === 'chatgpt' || profile.id === 'gemini') && !cdpStartedRef.current) {
        const r = await viewAPI.wbCdpStart(['/backend-api/', 'rpcids=']);
        cdpStartedRef.current = !!r?.success;
        if (cdpStartedRef.current) {
          (webview as any).reloadIgnoringCache?.() ?? webview.reload();
          await new Promise<void>(resolve => {
            const onStop = () => { webview.removeEventListener('did-stop-loading', onStop); resolve(); };
            webview.addEventListener('did-stop-loading', onStop);
          });
          await new Promise(r => setTimeout(r, 1500));
        }
      }

      let userMessage = '';
      let markdown = '';

      if (profile.id === 'claude') {
        const conv = await extractClaudeConversation(webview);
        if (!conv) return;
        let aSeen = -1;
        let pendingHuman = '';
        for (const m of conv.messages) {
          if (m.sender === 'human') pendingHuman = m.text;
          else if (m.sender === 'assistant') {
            aSeen++;
            if (aSeen === msgIndex) {
              userMessage = pendingHuman;
              markdown = m.text;
              break;
            }
            pendingHuman = '';
          }
        }
        markdown = await processClaudeArtifactsFull(webview, markdown);
      } else if (profile.id === 'chatgpt') {
        const c = await extractChatGPTContent(webview, viewAPI as any);
        // Coalesce one user prompt + following tool/assistant messages
        // into a single turn (DALL·E / Code Interpreter put images on
        // tool messages; pair them with the next assistant).
        type Turn = { user: string; text: string; fileIds: string[] };
        const turns: Turn[] = [];
        let cur: Turn | null = null;
        let pendingUser = '';
        let orphanFiles: string[] = [];
        for (const m of c.messages) {
          if (m.role === 'user' && m.text.trim()) {
            if (!cur && orphanFiles.length > 0 && pendingUser) {
              turns.push({ user: pendingUser, text: '', fileIds: orphanFiles });
            }
            pendingUser = m.text;
            orphanFiles = [];
            cur = null;
          } else if (m.role === 'tool') {
            for (const id of m.fileRefs) orphanFiles.push(id);
          } else if (m.role === 'assistant') {
            const hasText = m.text.trim().length > 0;
            const hasFiles = m.fileRefs.length > 0 || orphanFiles.length > 0;
            if (!hasText && !hasFiles) continue;
            if (!cur) {
              cur = { user: pendingUser, text: '', fileIds: [] };
              turns.push(cur);
              pendingUser = '';
            }
            if (hasText) cur.text = (cur.text ? cur.text + '\n\n' : '') + m.text;
            for (const id of orphanFiles) cur.fileIds.push(id);
            for (const id of m.fileRefs) cur.fileIds.push(id);
            orphanFiles = [];
          }
        }
        if (!cur && orphanFiles.length > 0 && pendingUser) {
          turns.push({ user: pendingUser, text: '', fileIds: orphanFiles });
        }
        const t = turns[msgIndex];
        if (t) {
          userMessage = t.user;
          markdown = t.text || '_[无文字内容]_';
          const imgLines: string[] = [];
          for (const fid of t.fileIds) {
            const f = c.files[fid];
            if (f?.dataUrl) imgLines.push(`![${f.fileId}](${f.dataUrl})`);
          }
          if (imgLines.length > 0) {
            markdown = markdown.trimEnd() + '\n\n' + imgLines.join('\n\n');
          }
        }
      } else if (profile.id === 'gemini') {
        const c = await extractGeminiContent(webview, viewAPI as any);
        const t = c.turns[msgIndex];
        if (t) {
          userMessage = t.userText;
          markdown = t.markdown;
          const imgLines: string[] = [];
          for (const img of t.images) {
            if (img.dataUrl) imgLines.push(`![](${img.dataUrl})`);
          }
          if (imgLines.length > 0) {
            markdown = markdown.trimEnd() + '\n\n' + imgLines.join('\n\n');
          }
        }
      }

      if (!markdown.trim()) {
        console.warn('[AIWebView Extract] No markdown for index', msgIndex);
        return;
      }

      viewAPI.sendToOtherSlot({
        protocol: 'ai-sync',
        action: 'as:append-turn',
        payload: {
          turn: {
            index: msgIndex,
            userMessage,
            markdown,
            timestamp: Date.now(),
          },
          source: {
            serviceId: profile.id,
            serviceName: profile.name,
          },
        },
      });
      console.log(`[AIWebView Extract] Sent turn #${msgIndex}: ${markdown.length} chars`);
    } catch (err) {
      console.warn('[AIWebView Extract] Failed:', err);
    }
  }, []);

  const aiContextItems = useMemo<ContextMenuItem[]>(() => [
    {
      id: 'extract-to-note',
      icon: '📥',
      label: '提取到笔记',
      visible: (ctx: MenuContext) => !!detectAIServiceByUrl(ctx.url),
      onClick: async (ctx: MenuContext) => {
        const profile = detectAIServiceByUrl(ctx.url);
        if (!profile) return;
        const idx = await resolveMsgIndex(ctx.webview, ctx.x, ctx.y, profile.selectors.assistantMessage);
        if (idx < 0) {
          console.warn('[AIWebView Extract] Right-click was not inside an assistant message');
          return;
        }
        await extractTurnAt(ctx, idx);
      },
    },
  ], [resolveMsgIndex, extractTurnAt]);

  // ── Live chat sync (auto, no toggle) ──
  // Fires whenever a Claude SSE response finishes (message_stop). If
  // the right-side NoteView is mounted, the just-finished turn is
  // forwarded as-is (Artifact placeholders become a "click Claude's
  // copy button" callout — no CDP / no mouse simulation, so we never
  // interfere with the user's reading).
  useEffect(() => {
    const handle = startSseTrigger(webviewRef);
    return handle.dispose;
  }, []);

  // ── Click outside service menu to close ──
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

  // ── AI_INJECT_AND_SEND (legacy "ask AI from Note" flow) ──
  useEffect(() => {
    const unsub = viewAPI.onAIInjectAndSend?.(async (params: {
      serviceId: string; prompt: string; noteId: string; thoughtId: string; responseChannel: string;
    }) => {
      let webview = webviewRef.current;
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

        const curUrl = webview.getURL?.() || '';
        if (!new RegExp(profile.urlPattern).test(curUrl)) {
          setAiStatus('injecting');
          webview.loadURL(profile.newChatUrl);
          setCurrentService(params.serviceId as AIServiceId);
          await new Promise<void>((resolve) => {
            const onLoad = () => { webview!.removeEventListener('did-finish-load', onLoad); resolve(); };
            webview!.addEventListener('did-finish-load', onLoad);
          });
          await new Promise(r => setTimeout(r, 3000));
        }

        setAiStatus('injecting');
        const sseScript = getSSECaptureScript(profile.id, profile.intercept.endpointPattern);
        await webview.executeJavaScript(sseScript);
        await webview.executeJavaScript('window.__krig_sse_responses = [];');

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

        await new Promise(r => setTimeout(r, 500));
        await webview.executeJavaScript(`(function() {
          var selector = ${JSON.stringify(profile.selectors.sendButton)};
          var selectors = selector.split(',').map(function(s) { return s.trim(); });
          var btn = null;
          for (var i = 0; i < selectors.length; i++) { btn = document.querySelector(selectors[i]); if (btn && !btn.disabled) break; btn = null; }
          if (btn) btn.click();
        })()`);

        setAiStatus('waiting');
        const startTime = Date.now();
        while (Date.now() - startTime < 90_000) {
          await new Promise(r => setTimeout(r, 1000));
          const status = await webview.executeJavaScript(`(function() {
            var r = window.__krig_sse_responses || [];
            var l = r.length > 0 ? r[r.length - 1] : null;
            return { count: r.length, streaming: l ? l.streaming : false };
          })()`);

          if (status.count > 0 && !status.streaming) {
            setAiStatus('capturing');
            const sseMarkdown = await webview.executeJavaScript(`(function() {
              var r = window.__krig_sse_responses || [];
              for (var i = r.length - 1; i >= 0; i--) { if (!r[i].streaming && r[i].markdown.length > 0) return r[i].markdown; }
              return null;
            })()`);

            const domScript2 = getDomToMarkdownScript();
            await webview.executeJavaScript(domScript2);
            const domMd = await webview.executeJavaScript(`(function() {
              if (typeof domToMarkdown !== 'function') return null;
              var selector = ${JSON.stringify(profile.selectors.assistantMessage)};
              var selectors = selector.split(',').map(function(s) { return s.trim(); });
              var all = [];
              for (var i = 0; i < selectors.length; i++) {
                var nodes = document.querySelectorAll(selectors[i]);
                for (var j = 0; j < nodes.length; j++) all.push(nodes[j]);
              }
              if (all.length === 0) return null;
              return domToMarkdown(all[all.length - 1]);
            })()`);

            let finalMd = sseMarkdown || domMd || '';
            if (sseMarkdown && domMd) {
              const sseImgs = new Set((sseMarkdown.match(/!\[([^\]]*)\]\(([^)]+)\)/g) || []).map((m: string) => m.match(/\(([^)]+)\)/)?.[1]).filter(Boolean));
              const extraImgs = (domMd.match(/!\[([^\]]*)\]\(([^)]+)\)/g) || []).filter((m: string) => { const u = m.match(/\(([^)]+)\)/)?.[1]; return u && !sseImgs.has(u); });
              if (extraImgs.length > 0) finalMd += '\n\n' + extraImgs.join('\n\n');
            }

            setAiStatus('idle');
            viewAPI.aiSendResponse?.(params.responseChannel, { success: true, markdown: finalMd });
            return;
          }
        }
        // Timeout fallback
        setAiStatus('capturing');
        const domScript3 = getDomToMarkdownScript();
        await webview.executeJavaScript(domScript3);
        const timeoutDomMd = await webview.executeJavaScript(`(function() {
          if (typeof domToMarkdown !== 'function') return null;
          var selector = ${JSON.stringify(profile.selectors.assistantMessage)};
          var selectors = selector.split(',').map(function(s) { return s.trim(); });
          var all = [];
          for (var i = 0; i < selectors.length; i++) {
            var nodes = document.querySelectorAll(selectors[i]);
            for (var j = 0; j < nodes.length; j++) all.push(nodes[j]);
          }
          if (all.length === 0) return null;
          return domToMarkdown(all[all.length - 1]);
        })()`);
        setAiStatus('idle');
        if (timeoutDomMd) {
          viewAPI.aiSendResponse?.(params.responseChannel, { success: true, markdown: timeoutDomMd });
        } else {
          viewAPI.aiSendResponse?.(params.responseChannel, { success: false, error: 'AI response timed out' });
        }
      } catch (err) {
        setAiStatus('idle');
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
      {/* AI Toolbar — no URL bar */}
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

        {/* Open view in right slot (Note / eBook / Web / Thought) */}
        <SlotToggle />

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
      <div className="web-view__content" style={{ position: 'relative' }}>
        <webview
          ref={setupWebview}
          src={initialUrl}
          className="web-view__webview"
          partition="persist:web"
          // @ts-ignore
          allowpopups="true"
        />
        <WebViewContextMenu webviewRef={webviewRef} items={aiContextItems} />
      </div>
    </div>
  );
}
