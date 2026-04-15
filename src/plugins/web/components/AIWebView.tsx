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
import { WEBVIEW_PARTITION } from '../../../shared/constants/webview-partition';
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

interface ClaudeRightClickTarget {
  msgIndex: number;
  artifactOrdinal: number | null;
}

const LAST_SERVICE_KEY = 'krig.ai.lastService';
const LIVE_SYNC_ENABLED_KEY = 'krig.ai.liveSync.enabled';

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

function loadLiveSyncEnabled(): boolean {
  try {
    return localStorage.getItem(LIVE_SYNC_ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function AIWebView({ workModeId: _workModeId = '' }: AIWebViewProps) {
  void _workModeId; // workModeId is kept for prop-API stability; not used yet.
  const webviewRef = useRef<Electron.WebviewTag | null>(null);
  const [currentService, setCurrentService] = useState<AIServiceId>(loadLastService);
  const [loading, setLoading] = useState(true);
  const [showServiceMenu, setShowServiceMenu] = useState(false);
  const [aiStatus, setAiStatus] = useState<'idle' | 'injecting' | 'waiting' | 'capturing'>('idle');
  const [liveSyncEnabled, setLiveSyncEnabled] = useState<boolean>(loadLiveSyncEnabled);
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
  /**
   * Resolve the assistant message at (x, y) and:
   *   1. return its ordinal among currently-mounted `.font-claude-response`
   *      nodes (used to pick the matching API message)
   *   2. tag the hit element with `data-krig-target="1"` so downstream
   *      scope-based iframe collection can find it even after the caller
   *      scrolls or the DOM reshuffles
   *
   * Caller must call `clearTargetMarker` after done.
   */
  const resolveMsgIndex = useCallback(async (
    webview: Electron.WebviewTag,
    x: number,
    y: number,
    assistantSelector: string,
  ): Promise<ClaudeRightClickTarget> => {
    const script = `(function() {
      var sel = ${JSON.stringify(assistantSelector)};
      var parts = sel.split(',').map(function(s) { return s.trim(); });
      var el = document.elementFromPoint(${x}, ${y});
      var hit = null;
      for (var i = 0; i < parts.length && !hit; i++) {
        hit = el && el.closest ? el.closest(parts[i]) : null;
      }
      if (!hit) return { index: -1, preview: '', total: 0, artifactOrdinal: null };
      var list = [];
      for (var j = 0; j < parts.length; j++) {
        var nodes = document.querySelectorAll(parts[j]);
        for (var k = 0; k < nodes.length; k++) list.push(nodes[k]);
      }
      // Clear any stale marker + tag the newly-hit node.
      var stale = document.querySelectorAll('[data-krig-target]');
      for (var s = 0; s < stale.length; s++) {
        stale[s].removeAttribute('data-krig-target');
        stale[s].removeAttribute('data-krig-click-x');
        stale[s].removeAttribute('data-krig-click-y');
      }
      hit.setAttribute('data-krig-target', '1');
      hit.setAttribute('data-krig-click-x', String(${x}));
      hit.setAttribute('data-krig-click-y', String(${y}));
      var cards = Array.from(document.querySelectorAll('[class*="group/artifact-block"]'));
      var allIframes = Array.from(document.querySelectorAll('iframe[src*="claudemcpcontent"]'));
      var standaloneIframes = allIframes.filter(function(f) { return !f.closest('[class*="group/artifact-block"]'); });
      var merged = cards.map(function(node) { return { form: 'card', el: node }; })
        .concat(standaloneIframes.map(function(node) { return { form: 'iframe', el: node }; }));
      merged.sort(function(a, b) {
        var rel = a.el.compareDocumentPosition(b.el);
        if (rel & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (rel & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });
      var artifactEl = null;
      if (el) {
        if (el.tagName === 'IFRAME' && String(el.src || '').indexOf('claudemcpcontent') >= 0) artifactEl = el;
        if (!artifactEl && el.closest) artifactEl = el.closest('[class*="group/artifact-block"]');
        if (!artifactEl) {
          var localIframe = hit.querySelector('iframe[src*="claudemcpcontent"]');
          if (localIframe) artifactEl = localIframe;
        }
      }
      var artifactOrdinal = null;
      if (artifactEl) {
        for (var a = 0; a < merged.length; a++) {
          if (merged[a].el === artifactEl) { artifactOrdinal = a; break; }
        }
      }
      var text = (hit.innerText || hit.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160);
      return { index: list.indexOf(hit), preview: text, total: list.length, artifactOrdinal: artifactOrdinal };
    })()`;
    try {
      const r = await webview.executeJavaScript(script);
      if (r && typeof r.index === 'number') {
        return {
          msgIndex: r.index,
          artifactOrdinal: typeof r.artifactOrdinal === 'number' ? r.artifactOrdinal : null,
        };
      }
      return { msgIndex: -1, artifactOrdinal: null };
    } catch {
      return { msgIndex: -1, artifactOrdinal: null };
    }
  }, []);

  const clearTargetMarker = useCallback(async (webview: Electron.WebviewTag) => {
    try {
      await webview.executeJavaScript(
        `(function(){var s=document.querySelectorAll('[data-krig-target]');for(var i=0;i<s.length;i++){s[i].removeAttribute('data-krig-target');s[i].removeAttribute('data-krig-click-x');s[i].removeAttribute('data-krig-click-y');}})()`,
      );
    } catch {}
  }, []);

  const freezeViewport = useCallback(async (webview: Electron.WebviewTag) => {
    try {
      await webview.executeJavaScript(`
        (function() {
          if (window.__krigFreezeViewport) return;
          var sx = window.scrollX || window.pageXOffset || 0;
          var sy = window.scrollY || window.pageYOffset || 0;
          var orig = {
            scrollTo: window.scrollTo,
            scrollBy: window.scrollBy,
            scrollIntoView: Element.prototype.scrollIntoView,
          };
          window.__krigFreezeViewport = { sx: sx, sy: sy, orig: orig };
          window.scrollTo = function() {};
          window.scrollBy = function() {};
          Element.prototype.scrollIntoView = function() {};
          var root = document.scrollingElement || document.documentElement || document.body;
          if (root) root.style.scrollBehavior = 'auto';
          document.documentElement.style.overscrollBehavior = 'none';
          document.body.style.overscrollBehavior = 'none';
          document.documentElement.style.overflow = 'hidden';
          document.body.style.overflow = 'hidden';
          window.addEventListener('scroll', function() { orig.scrollTo.call(window, sx, sy); }, true);
          orig.scrollTo.call(window, sx, sy);
        })()
      `).catch(() => {});
    } catch {}
  }, []);

  const restoreViewport = useCallback(async (webview: Electron.WebviewTag) => {
    try {
      await webview.executeJavaScript(`
        (function() {
          var frozen = window.__krigFreezeViewport;
          if (!frozen) return;
          window.scrollTo = frozen.orig.scrollTo;
          window.scrollBy = frozen.orig.scrollBy;
          Element.prototype.scrollIntoView = frozen.orig.scrollIntoView;
          document.documentElement.style.overscrollBehavior = '';
          document.body.style.overscrollBehavior = '';
          document.documentElement.style.overflow = '';
          document.body.style.overflow = '';
          frozen.orig.scrollTo.call(window, frozen.sx, frozen.sy);
          delete window.__krigFreezeViewport;
        })()
      `).catch(() => {});
    } catch {}
  }, []);

  const cdpStartedRef = useRef(false);
  const sseTriggerRef = useRef<ReturnType<typeof startSseTrigger> | null>(null);

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
      // Manual extraction and live chat sync are mutually exclusive.
      // Turn sync off first so the same Claude turn is not auto-appended.
      setLiveSyncEnabled(false);
      try { localStorage.setItem(LIVE_SYNC_ENABLED_KEY, '0'); } catch {}
      sseTriggerRef.current?.suspendFor(15000);
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
        try {
          await freezeViewport(webview);
          markdown = await processClaudeArtifactsFull(webview, markdown, {
            scopeSelector: '[data-krig-target="1"]',
            preferredArtifactOrdinals: (ctx as MenuContext & { artifactOrdinal?: number | null }).artifactOrdinal != null
              ? [(ctx as MenuContext & { artifactOrdinal?: number | null }).artifactOrdinal as number]
              : undefined,
          });
        } finally {
          await restoreViewport(webview);
          await clearTargetMarker(webview);
        }
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
        const target = await resolveMsgIndex(ctx.webview, ctx.x, ctx.y, profile.selectors.assistantMessage);
        if (target.msgIndex < 0) {
          console.warn('[AIWebView Extract] Right-click was not inside an assistant message');
          return;
        }
        await extractTurnAt(
          { ...ctx, artifactOrdinal: target.artifactOrdinal } as MenuContext & { artifactOrdinal?: number | null },
          target.msgIndex,
        );
      },
    },
  ], [resolveMsgIndex, extractTurnAt]);

  // ── Live chat sync (opt-in toggle) ──
  useEffect(() => {
    if (!liveSyncEnabled) {
      sseTriggerRef.current?.dispose();
      sseTriggerRef.current = null;
      return;
    }
    const handle = startSseTrigger(webviewRef);
    sseTriggerRef.current = handle;
    return () => {
      if (sseTriggerRef.current === handle) sseTriggerRef.current = null;
      handle.dispose();
    };
  }, [liveSyncEnabled]);

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
        <button
          style={{
            background: liveSyncEnabled ? '#1f4b2b' : '#333',
            border: `1px solid ${liveSyncEnabled ? '#2f7d46' : '#555'}`,
            borderRadius: 6,
            color: liveSyncEnabled ? '#d9ffe3' : '#e8eaed',
            fontSize: 13,
            padding: '4px 12px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
          }}
          onClick={() => {
            const next = !liveSyncEnabled;
            setLiveSyncEnabled(next);
            try { localStorage.setItem(LIVE_SYNC_ENABLED_KEY, next ? '1' : '0'); } catch {}
          }}
          title={liveSyncEnabled ? '关闭聊天自动同步到 Note' : '开启聊天自动同步到 Note'}
        >
          聊天同步
        </button>

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
          partition={WEBVIEW_PARTITION}
          // @ts-ignore
          allowpopups="true"
        />
        <WebViewContextMenu webviewRef={webviewRef} items={aiContextItems} />
      </div>
    </div>
  );
}
