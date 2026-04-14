import { useState, useRef, useCallback, useEffect } from 'react';
import { getSSECaptureScript } from '../../web-bridge/injection/inject-scripts/sse-capture';
import { getArtifactPostMessageHookScript } from '../../web-bridge/injection/inject-scripts/artifact-postmessage-hook';
import { getDomToMarkdownScript } from '../../web-bridge/injection/inject-scripts/dom-to-markdown';
import {
  extractLatestClaudeResponse,
  isClaudeConversationPage,
  countArtifactPlaceholders,
  replaceArtifactPlaceholders,
  readCapturedArtifactMessages,
  collectArtifactSources,
  fillArtifactPlaceholders,
  fetchClaudeArtifactVersions,
  extractArtifactVersionSource,
} from '../../web-bridge/capabilities/claude-api-extractor';
import { extractContent as extractChatGPTContent } from '../../web-bridge/capabilities/chatgpt-content-extractor';
import { extractContent as extractGeminiContent } from '../../web-bridge/capabilities/gemini-content-extractor';
import { getAIServiceProfile, getAIServiceList, DEFAULT_AI_SERVICE, detectAIServiceByUrl } from '../../../shared/types/ai-service-types';
import type { AIServiceId } from '../../../shared/types/ai-service-types';
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
  wbCdpGetResponses: () => Promise<{ success: boolean; error?: string; count?: number; responses?: Array<{ url: string; statusCode: number; mimeType: string; bodyLength: number; bodyPreview: string | null; timestamp: number }> }>;
  wbCdpFindResponse: (params: { urlSubstring: string; mode?: 'all' | 'latest' | 'first' }) =>
    Promise<{ success: boolean; error?: string; count?: number; matches?: Array<{ url: string; statusCode: number; mimeType: string; body: string | null; bodyLength: number; timestamp: number }> }>;
  wbSendMouse: (events: Array<{ type: string; x: number; y: number; button?: string; buttons?: number; clickCount?: number }>) =>
    Promise<{ success: boolean; error?: string; count?: number }>;
  wbReadClipboardImage: () =>
    Promise<{ success: boolean; empty?: boolean; dataUrl?: string; width?: number; height?: number }>;
  wbCaptureDownloadOnce: (timeoutMs?: number) =>
    Promise<{ success: boolean; filename?: string; mimeType?: string; content?: string; error?: string }>;
  wbFetchBinary: (params: { url: string; headers?: Record<string, string>; timeoutMs?: number }) =>
    Promise<{ success: boolean; base64?: string; mimeType?: string; bodyLength?: number; error?: string }>;
  aiExtractDebug: (params: { markdown: string; serviceId: string }) =>
    Promise<{ success: boolean; atomCount?: number; blocks?: number; error?: string; preview?: string; blockTypes?: string[]; atomTypes?: string[]; blockDetails?: any[]; atomDetails?: any[] }>;
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
interface AIWebViewProps {
  workModeId?: string;
}

export function AIWebView({ workModeId = '' }: AIWebViewProps) {
  const isSyncMode = workModeId === 'ai-sync';
  const webviewRef = useRef<Electron.WebviewTag | null>(null);
  const [currentService, setCurrentService] = useState<AIServiceId>(DEFAULT_AI_SERVICE);
  const [currentUrl, setCurrentUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [showServiceMenu, setShowServiceMenu] = useState(false);
  const [aiStatus, setAiStatus] = useState<'idle' | 'injecting' | 'waiting' | 'capturing'>('idle');
  const [syncEnabled, setSyncEnabled] = useState(isSyncMode);
  const [syncCount, setSyncCount] = useState(0);
  const lastSyncedCountRef = useRef(0);
  const menuRef = useRef<HTMLDivElement>(null);

  const initialUrl = getAIServiceProfile(DEFAULT_AI_SERVICE).newChatUrl;

  // ── webview 事件绑定 ──
  const setupWebview = useCallback((el: Electron.WebviewTag | null) => {
    if (!el || webviewRef.current === el) return;
    webviewRef.current = el;

    el.addEventListener('did-start-loading', () => setLoading(true));
    el.addEventListener('did-stop-loading', () => setLoading(false));
    const injectArtifactHookIfClaude = () => {
      try {
        const u = el.getURL?.() || '';
        if (u.indexOf('claude.ai') !== -1) {
          el.executeJavaScript(getArtifactPostMessageHookScript()).catch(() => {});
        }
      } catch {}
    };

    el.addEventListener('did-navigate', (_e: any) => {
      setCurrentUrl(el.getURL());
      const detected = detectAIServiceByUrl(el.getURL());
      if (detected) setCurrentService(detected.id);
      injectArtifactHookIfClaude();
    });
    el.addEventListener('did-navigate-in-page', () => {
      setCurrentUrl(el.getURL());
      injectArtifactHookIfClaude();
    });
    el.addEventListener('dom-ready', injectArtifactHookIfClaude);

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

  // ── Sync Engine（场景 C：实时同步到 NoteView）──
  // Tracks per-service sync state by conversationId → set of synced response ids
  const syncedResponsesRef = useRef<Map<string, Set<string>>>(new Map());
  const cdpStartedRef = useRef(false);
  // Peer (NoteView) status — updated via 'as:note-status' ViewMessage
  const noteOpenRef = useRef(false);
  const lastTypedAtRef = useRef(0);
  const [noteOpen, setNoteOpen] = useState(false);

  useEffect(() => {
    if (!isSyncMode || !syncEnabled) return;

    // AI-Note workflow Step 1: don't spam the user's notebook with a fresh
    // "AI Sync — …" note every time they toggle sync. Instead reuse the
    // workspace's lastActive note (already persisted as activeNoteId).
    // Fallback chain: activeNoteId (if it still exists) → most-recently-
    // updated note in the library → show Note view's empty state and let
    // the user decide (new / open).
    (async () => {
      await viewAPI.ensureRightSlot('demo-a');
      await new Promise(r => setTimeout(r, 1500));

      const lastActiveId = await viewAPI.getActiveNoteId();
      if (lastActiveId) {
        const existing = await viewAPI.noteLoad(lastActiveId);
        if (existing) {
          await viewAPI.noteOpenInEditor(lastActiveId);
          console.log('[AIWebView Sync] Opened lastActive note:', lastActiveId);
          return;
        }
        // lastActive pointed to a deleted note; fall through to list.
      }

      const list = await viewAPI.noteList();
      if (Array.isArray(list) && list.length > 0) {
        const latest = (list[0] as { id: string }).id;
        await viewAPI.noteOpenInEditor(latest);
        console.log('[AIWebView Sync] Opened most-recent note:', latest);
        return;
      }

      // Library is empty — do nothing. Note view will show its empty
      // state with a "new note" button for the user to start from.
      console.log('[AIWebView Sync] No notes available; awaiting user new/open.');
    })();

    console.log('[AIWebView Sync] Sync mode started, polling for responses...');

    // Listen for NoteView status broadcasts.
    const unsubStatus = viewAPI.onMessage((msg: any) => {
      if (msg.protocol === 'ai-sync' && msg.action === 'as:note-status') {
        const open = !!msg.payload?.open;
        const t = Number(msg.payload?.lastTypedAt) || 0;
        noteOpenRef.current = open;
        if (t > lastTypedAtRef.current) lastTypedAtRef.current = t;
        setNoteOpen(open);
      }
    });

    // Probe: ask any live NoteView to announce itself (handles case where
    // NoteView mounted before sync engine started).
    viewAPI.sendToOtherSlot({ protocol: 'ai-sync', action: 'as:probe', payload: null });

    // Auto-start CDP once per sync session; ChatGPT/Gemini need it to observe
    // the Service Worker / batchexecute traffic that page scripts can't see.
    (async () => {
      if (cdpStartedRef.current) return;
      try {
        const r = await viewAPI.wbCdpStart(['/backend-api/', 'rpcids=', '/api/organizations/']);
        cdpStartedRef.current = !!r?.success;
        console.log('[AIWebView Sync] CDP start:', r?.success, r?.error || '');
      } catch (err) {
        console.warn('[AIWebView Sync] CDP start failed:', err);
      }
    })();

    const sendTurn = (payload: {
      responseId: string;
      index: number;
      userMessage: string;
      markdown: string;
      serviceId: string;
      serviceName: string;
    }) => {
      viewAPI.sendToOtherSlot({
        protocol: 'ai-sync',
        action: 'as:append-turn',
        payload: {
          turn: {
            index: payload.index,
            userMessage: payload.userMessage,
            markdown: payload.markdown,
            timestamp: Date.now(),
          },
          source: {
            serviceId: payload.serviceId,
            serviceName: payload.serviceName,
          },
        },
      });
      setSyncCount(c => c + 1);
    };

    /** Get (or create) the synced-response-id set for a conversation. */
    const getSyncedSet = (convId: string): Set<string> => {
      let set = syncedResponsesRef.current.get(convId);
      if (!set) {
        set = new Set();
        syncedResponsesRef.current.set(convId, set);
      }
      return set;
    };

    // Poll for new responses
    const pollInterval = setInterval(async () => {
      const webview = webviewRef.current;
      if (!webview) return;

      // Boundary: NoteView not open → pause (UI shows ⏸).
      if (!noteOpenRef.current) return;
      // Boundary: user typed within 500ms → defer so we don't interrupt them.
      if (Date.now() - lastTypedAtRef.current < 500) return;

      try {
        const curUrl = webview.getURL?.() || '';
        const detected = detectAIServiceByUrl(curUrl);
        if (!detected) return;

        if (detected.id === 'claude') {
          await syncClaude(webview, detected.name);
        } else if (detected.id === 'chatgpt') {
          await syncChatGPT(webview, detected.name);
        } else if (detected.id === 'gemini') {
          await syncGemini(webview, detected.name);
        }
      } catch (err) {
        console.warn('[AIWebView Sync] Error:', err);
      }
    }, 2000);

    async function syncChatGPT(webview: Electron.WebviewTag, serviceName: string) {
      const c = await extractChatGPTContent(webview, viewAPI as any);
      if (!c.conversationId || c.messages.length === 0) return;
      const synced = getSyncedSet(c.conversationId);

      // Walk messages in order; for each user→assistant pair not yet synced, send.
      let pendingUser = '';
      let turnIdx = synced.size;
      for (const m of c.messages) {
        if (m.role === 'user' && m.text.trim()) {
          pendingUser = m.text.trim();
        } else if (m.role === 'assistant' && m.text.trim() && pendingUser) {
          if (!synced.has(m.id)) {
            synced.add(m.id);
            sendTurn({
              responseId: m.id,
              index: turnIdx++,
              userMessage: pendingUser,
              markdown: m.text,
              serviceId: 'chatgpt',
              serviceName,
            });
            console.log(`[AIWebView Sync/ChatGPT] Sent turn ${m.id}: ${m.text.length} chars`);
          }
          pendingUser = '';
        }
      }
    }

    async function syncGemini(webview: Electron.WebviewTag, serviceName: string) {
      const c = await extractGeminiContent(webview, viewAPI as any);
      if (!c.conversationId || c.turns.length === 0) return;
      const synced = getSyncedSet(c.conversationId);

      let turnIdx = synced.size;
      for (const t of c.turns) {
        if (synced.has(t.responseId)) continue;
        if (!t.markdown.trim()) continue;
        synced.add(t.responseId);
        sendTurn({
          responseId: t.responseId,
          index: turnIdx++,
          userMessage: t.userText,
          markdown: t.markdown,
          serviceId: 'gemini',
          serviceName,
        });
        console.log(`[AIWebView Sync/Gemini] Sent turn ${t.responseId}: ${t.markdown.length} chars`);
      }
    }

    async function syncClaude(webview: Electron.WebviewTag, serviceName: string) {
      const curUrl = webview.getURL?.() || '';
      if (!isClaudeConversationPage(curUrl)) return;

      const apiResult = await extractLatestClaudeResponse(webview);
      if (!apiResult || !apiResult.raw) return;

      const conv = apiResult.raw;
      const humanCount = conv.messages.filter(m => m.sender === 'human').length;

      while (humanCount > lastSyncedCountRef.current) {
        const idx = lastSyncedCountRef.current;

        // Find the idx-th human message and its next assistant response
        let humanFound = -1;
        let humanMsg = '';
        let assistantMsg = '';
        for (let i = 0; i < conv.messages.length; i++) {
          if (conv.messages[i].sender === 'human') humanFound++;
          if (humanFound === idx && conv.messages[i].sender === 'human') {
            humanMsg = conv.messages[i].text;
            for (let j = i + 1; j < conv.messages.length; j++) {
              if (conv.messages[j].sender === 'assistant') {
                assistantMsg = conv.messages[j].text;
                break;
              }
            }
            break;
          }
        }

        if (!assistantMsg) {
          // Streaming not finished yet — wait for next poll
          break;
        }

        // Replace Artifact placeholders: prefer captured postMessage
        // source, fall back to callout for any that weren't captured.
        const artifactCount = countArtifactPlaceholders(assistantMsg);
        let finalMarkdown = assistantMsg;
        if (artifactCount > 0) {
          try { await webview.executeJavaScript(getArtifactPostMessageHookScript()); } catch {}

          let versionSources: string[] = [];
          for (let attempt = 0; attempt < 5; attempt++) {
            const versions = await fetchClaudeArtifactVersions(webview);
            if (versions && versions.length > 0) {
              versionSources = versions
                .map(v => extractArtifactVersionSource(v))
                .filter((s): s is string => !!s);
              if (versionSources.length > 0) break;
            }
            await new Promise(r => setTimeout(r, 800));
          }

          const captured = await readCapturedArtifactMessages(webview);
          const capturedSources = collectArtifactSources(captured);
          const sources = [...versionSources.slice().reverse(), ...capturedSources];
          const filled = fillArtifactPlaceholders(assistantMsg, sources);
          console.log(`[Claude/Artifact] versions=${versionSources.length} captured=${capturedSources.length}`);
          finalMarkdown = filled.remaining > 0
            ? replaceArtifactPlaceholders(filled.text, webview.getURL())
            : filled.text;
          console.log(`[Claude/Artifact] Response #${idx}: ${artifactCount} placeholder(s), filled ${filled.filled}, remaining ${filled.remaining}`);
        }

        console.log(`[AIWebView Sync/Claude] Response #${idx}: ${finalMarkdown.length} chars`);

        sendTurn({
          responseId: `claude-${idx}`,
          index: idx,
          userMessage: humanMsg,
          markdown: finalMarkdown,
          serviceId: 'claude',
          serviceName,
        });
        lastSyncedCountRef.current = idx + 1;
      }
    }

    return () => {
      clearInterval(pollInterval);
      unsubStatus();
    };
  }, [isSyncMode, syncEnabled, currentService]);

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

            // SSE markdown
            const sseMarkdown = await webview.executeJavaScript(`(function() {
              var r = window.__krig_sse_responses || [];
              for (var i = r.length - 1; i >= 0; i--) { if (!r[i].streaming && r[i].markdown.length > 0) return r[i].markdown; }
              return null;
            })()`);

            // DOM markdown (complement — captures images/artifacts SSE misses)
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

            // Merge: SSE + DOM images
            let finalMd = sseMarkdown || domMd || '';
            if (sseMarkdown && domMd) {
              const sseImgs = new Set((sseMarkdown.match(/!\[([^\]]*)\]\(([^)]+)\)/g) || []).map((m: string) => m.match(/\(([^)]+)\)/)?.[1]).filter(Boolean));
              const extraImgs = (domMd.match(/!\[([^\]]*)\]\(([^)]+)\)/g) || []).filter((m: string) => { const u = m.match(/\(([^)]+)\)/)?.[1]; return u && !sseImgs.has(u); });
              if (extraImgs.length > 0) finalMd += '\n\n' + extraImgs.join('\n\n');
            }

            console.log(`[AIWebView] Captured: SSE=${sseMarkdown?.length ?? 0}, DOM=${domMd?.length ?? 0}, final=${finalMd.length}`);
            setAiStatus('idle');
            viewAPI.aiSendResponse?.(params.responseChannel, { success: true, markdown: finalMd });
            return;
          }
        }
        // Timeout — try DOM extraction as last resort
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
          console.log(`[AIWebView] SSE timeout but DOM extracted: ${timeoutDomMd.length} chars`);
          viewAPI.aiSendResponse?.(params.responseChannel, { success: true, markdown: timeoutDomMd });
        } else {
          viewAPI.aiSendResponse?.(params.responseChannel, { success: false, error: 'AI response timed out (SSE + DOM both empty)' });
        }
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

        {/* Sync status (only in ai-sync mode) */}
        {isSyncMode && (
          <button
            style={{
              background: !syncEnabled ? '#555' : (noteOpen ? '#1b5e20' : '#8a6d3b'),
              border: 'none', borderRadius: 4, color: '#fff',
              fontSize: 11, padding: '3px 8px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
            onClick={() => setSyncEnabled(!syncEnabled)}
            title={!syncEnabled ? '恢复同步' : noteOpen ? '暂停同步' : '等待 NoteView 打开'}
          >
            <span>{!syncEnabled ? '⏸' : noteOpen ? '●' : '⏸'}</span>
            <span>
              {!syncEnabled ? '已暂停' : noteOpen ? `同步中 (${syncCount})` : `等待笔记 (${syncCount})`}
            </span>
          </button>
        )}

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
      <div className="web-view__content" style={{ position: 'relative' }}>
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
