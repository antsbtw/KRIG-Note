import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { getSSECaptureScript } from '../../web-bridge/injection/inject-scripts/sse-capture';
import { getArtifactPostMessageHookScript } from '../../web-bridge/injection/inject-scripts/artifact-postmessage-hook';
import { getDomToMarkdownScript } from '../../web-bridge/injection/inject-scripts/dom-to-markdown';
import { SlotToggle } from '../../../shared/components/SlotToggle';
import { WebViewContextMenu, type ContextMenuItem, type MenuContext } from '../context-menu';
import {
  extractClaudeConversation,
  extractLatestClaudeResponse,
  isClaudeConversationPage,
  countArtifactPlaceholders,
  replaceArtifactPlaceholders,
  readCapturedArtifactMessages,
  collectArtifactSources,
  fillArtifactPlaceholders,
  fillArtifactPlaceholdersWithImages,
  fetchClaudeArtifactVersions,
  extractArtifactVersionSource,
} from '../../web-bridge/capabilities/claude-api-extractor';
import { extractAll as extractAllClaudeArtifacts } from '../../web-bridge/capabilities/claude-artifact-extractor';
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

const LAST_SERVICE_KEY = 'krig.ai.lastService';
const SYNC_ENABLED_KEY_PREFIX = 'krig.ai.syncEnabled.'; // + serviceId

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

/** Per-service sync toggle persistence. Default: on (enter sync mode = wants sync). */
function loadSyncEnabled(serviceId: AIServiceId): boolean {
  try {
    const v = localStorage.getItem(SYNC_ENABLED_KEY_PREFIX + serviceId);
    if (v === '0') return false;
    if (v === '1') return true;
  } catch {}
  return true;
}

function saveSyncEnabled(serviceId: AIServiceId, enabled: boolean): void {
  try { localStorage.setItem(SYNC_ENABLED_KEY_PREFIX + serviceId, enabled ? '1' : '0'); } catch {}
}

/**
 * Resolve Claude Artifact placeholders inside an assistant message.
 *
 * Three layers of fill, in order of fidelity:
 *   1. Versions API + postMessage source (real markup when exposed)
 *   2. Copy-to-clipboard rendered PNG via CDP mouse simulation
 *   3. Friendly "view in Claude" callout (last resort)
 *
 * Shared by both the live sync engine and the right-click extract path
 * so Artifacts behave identically regardless of trigger.
 */
async function processClaudeArtifacts(
  webview: Electron.WebviewTag,
  assistantMsg: string,
): Promise<string> {
  const artifactCount = countArtifactPlaceholders(assistantMsg);
  if (artifactCount === 0) return assistantMsg;

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
  console.log(`[Claude/Artifact] versions=${versionSources.length} captured=${capturedSources.length} filled=${filled.filled}/${artifactCount}`);
  let out = filled.text;

  if (filled.remaining > 0) {
    // Claude lazy-loads artifact iframes (often outside the viewport).
    // First nudge any artifact host elements into view to trigger mount,
    // then poll for iframes appearing in the DOM.
    const expectedIframes = filled.remaining;
    try {
      await webview.executeJavaScript(`
        (function() {
          var hosts = document.querySelectorAll('[class*="artifact"], [data-testid*="artifact"]');
          for (var i = 0; i < hosts.length; i++) hosts[i].scrollIntoView({ block: 'center', behavior: 'instant' });
        })()
      `).catch(() => {});
    } catch {}
    let lastFound = 0;
    for (let attempt = 0; attempt < 20; attempt++) {
      const found = await webview.executeJavaScript(
        'document.querySelectorAll(\'iframe[src*="claudemcpcontent"], iframe[src*="claudeusercontent"]\').length',
      ).catch(() => 0);
      lastFound = typeof found === 'number' ? found : 0;
      if (lastFound >= expectedIframes) break;
      await new Promise(r => setTimeout(r, 500));
    }
    console.log(`[Claude/Artifact] iframe wait: found=${lastFound} expected=${expectedIframes}`);

    try {
      const artifacts = await extractAllClaudeArtifacts(
        webview,
        viewAPI as any,
        { image: true },
      );
      const rawImgs = artifacts.map(a => a.image?.dataUrl).filter((s): s is string => !!s);
      // Dedupe by dataUrl: side-panel + inline + fullscreen often render
      // the same artifact 2–3 times with identical PNG output. Keep a
      // single copy so multi-placeholder messages don't end up with the
      // same image in every slot.
      const seenImgs = new Set<string>();
      const imgs: string[] = [];
      for (const u of rawImgs) {
        if (seenImgs.has(u)) continue;
        seenImgs.add(u);
        imgs.push(u);
      }
      console.log(`[Claude/Artifact] CDP image capture: ${imgs.length} unique image(s) (raw=${rawImgs.length}) for ${expectedIframes} expected iframe(s); descriptors=${artifacts.length}`);
      for (let i = 0; i < artifacts.length; i++) {
        const a = artifacts[i];
        console.log(`  descriptor[${i}] src=${a.iframeSrc?.slice(0, 80)} hasImage=${!!a.image} isFullscreen=${a.isFullscreen}`);
      }
      if (imgs.length > 0) {
        const imgFill = fillArtifactPlaceholdersWithImages(out, imgs);
        out = imgFill.text;
        console.log(`[Claude/Artifact] image fallback filled ${imgFill.filled}/${imgs.length}, remaining ${imgFill.remaining}`);
        if (imgFill.remaining > 0) {
          out = replaceArtifactPlaceholders(out, webview.getURL());
        }
      } else {
        out = replaceArtifactPlaceholders(out, webview.getURL());
      }
    } catch (err) {
      console.warn('[Claude/Artifact] image fallback failed:', err);
      out = replaceArtifactPlaceholders(out, webview.getURL());
    }
  }
  return out;
}

export function AIWebView({ workModeId = '' }: AIWebViewProps) {
  const isSyncMode = workModeId === 'ai-sync';
  const webviewRef = useRef<Electron.WebviewTag | null>(null);
  const [currentService, setCurrentService] = useState<AIServiceId>(loadLastService);
  const [currentUrl, setCurrentUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [showServiceMenu, setShowServiceMenu] = useState(false);
  const [aiStatus, setAiStatus] = useState<'idle' | 'injecting' | 'waiting' | 'capturing'>('idle');
  const [syncEnabled, setSyncEnabledState] = useState(() =>
    isSyncMode && loadSyncEnabled(loadLastService()),
  );
  const [syncCount, setSyncCount] = useState(0);

  /** Toggle and persist per-service. */
  const setSyncEnabled = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    setSyncEnabledState(prev => {
      const v = typeof next === 'function' ? next(prev) : next;
      saveSyncEnabled(currentService, v);
      return v;
    });
  }, [currentService]);

  // When the active service changes, load that service's own saved toggle.
  useEffect(() => {
    if (!isSyncMode) return;
    setSyncEnabledState(loadSyncEnabled(currentService));
  }, [currentService, isSyncMode]);
  const lastSyncedCountRef = useRef(0);
  const menuRef = useRef<HTMLDivElement>(null);

  const initialUrl = getAIServiceProfile(currentService).newChatUrl;

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

    // Right-click menu is handled by the shared WebViewContextMenu. The
    // guest preload (web-content.ts) owns the document listener and the
    // signal is forwarded via ipc-message, so no per-navigation install
    // is needed here.

    el.addEventListener('did-navigate', (_e: any) => {
      setCurrentUrl(el.getURL());
      const detected = detectAIServiceByUrl(el.getURL());
      if (detected) {
        setCurrentService(detected.id);
        try { localStorage.setItem(LAST_SERVICE_KEY, detected.id); } catch {}
      }
      injectArtifactHookIfClaude();
    });
    el.addEventListener('did-navigate-in-page', () => {
      setCurrentUrl(el.getURL());
      injectArtifactHookIfClaude();
    });
    el.addEventListener('dom-ready', () => {
      injectArtifactHookIfClaude();
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
    try { localStorage.setItem(LAST_SERVICE_KEY, serviceId); } catch {}
  }, []);

  // ── Mode B: Right-click extract ──
  // Compute the 0-based assistantMessage index at the given viewport
  // coordinates by asking the guest page itself — document.elementFromPoint
  // is the one reliable way since DOM layout differs by service and by
  // viewport size.
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

  // Extract the assistant message at the given DOM index by calling the
  // service's own extractor (API source, not DOM scrape) and emit a
  // standard as:append-turn so the insert path is identical to real-time sync.
  const extractTurnAt = useCallback(async (ctx: MenuContext, msgIndex: number) => {
    const webview = ctx.webview;
    const url = ctx.url;
    const profile = detectAIServiceByUrl(url);
    if (!profile) return;

    try {
      // Ensure right slot (NoteView) exists so the insert has a target.
      await viewAPI.ensureRightSlot('demo-a');

      // ChatGPT / Gemini need CDP to see the conversation API response.
      // If we haven't started it yet (user skipped sync mode), start now
      // and reload so the response gets captured. Claude uses page fetch,
      // no CDP needed.
      if ((profile.id === 'chatgpt' || profile.id === 'gemini') && !cdpStartedRef.current) {
        console.log('[AIWebView Extract] Starting CDP for', profile.id);
        const r = await viewAPI.wbCdpStart(['/backend-api/', 'rpcids=']);
        cdpStartedRef.current = !!r?.success;
        if (cdpStartedRef.current) {
          // reloadIgnoringCache forces conversation / estuary / etc. to
          // re-hit the network so CDP can capture the bodies. A plain
          // reload would serve image bytes from HTTP cache and leave
          // the CDP response map empty.
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
        // Pair human → assistant in document order, pick the msgIndex-th assistant.
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
        // Resolve Claude Artifact placeholders (same pipeline as sync).
        markdown = await processClaudeArtifacts(webview, markdown);
      } else if (profile.id === 'chatgpt') {
        const c = await extractChatGPTContent(webview, viewAPI as any);
        console.log('[AIWebView Extract/ChatGPT] convId=', c.conversationId,
          'messages=', c.messages.length,
          'warnings=', c.warnings);
        // Coalesce one user prompt + following tool/assistant messages into
        // a single "turn". An assistant counts as a content-turn if it
        // has text OR any fileRefs (DALL·E / Code Interpreter produce
        // assistants whose only content is an image attachment).
        type Turn = { user: string; text: string; fileIds: string[] };
        const turns: Turn[] = [];
        let cur: Turn | null = null;
        let pendingUser = '';
        // Flush on user boundary: if tool messages accumulated fileRefs
        // since the last user prompt but no assistant absorbed them
        // (DALL·E case), emit a turn anyway so the image isn't lost.
        const flushOrphanTool = () => {
          if (!cur && pendingUser && /* have leftover tool files */ false) {
            // handled below via orphanFiles
          }
        };
        void flushOrphanTool;
        let orphanFiles: string[] = [];
        for (const m of c.messages) {
          if (m.role === 'user' && m.text.trim()) {
            // Before starting a new user turn, flush any orphan tool files
            // (rare: tool output without following assistant text).
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
        // End-of-list flush.
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

  // Context-menu item list contributed by the AI variant. The base
  // WebViewContextMenu appends the built-ins (reload, inspect).
  const aiContextItems = useMemo<ContextMenuItem[]>(() => [
    {
      id: 'extract-to-note',
      icon: '📥',
      label: '提取到笔记',
      // Only meaningful when the click landed inside an assistant message.
      visible: (ctx: MenuContext) => {
        const profile = detectAIServiceByUrl(ctx.url);
        return !!profile; // on any AI page
      },
      enabled: (ctx: MenuContext) => {
        // Cheap pre-filter from the targetHtml snapshot; the real
        // selector match happens inside onClick via executeJavaScript.
        const profile = detectAIServiceByUrl(ctx.url);
        if (!profile) return false;
        return true;
      },
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

  // ── Sync Engine（场景 C：实时同步到 NoteView）──
  // Tracks per-service sync state by conversationId → set of synced response ids
  const syncedResponsesRef = useRef<Map<string, Set<string>>>(new Map());
  const cdpStartedRef = useRef(false);
  // Prevent overlapping poll invocations: a single poll pass can take longer
  // than the 2 s interval (Claude artifact probe waits up to 4 s), so we
  // must skip re-entry rather than let two passes race on lastSyncedCountRef
  // and double-insert the same turn.
  const pollInFlightRef = useRef(false);
  // Peer (NoteView) status — updated via 'as:note-status' ViewMessage
  const noteOpenRef = useRef(false);
  const lastTypedAtRef = useRef(0);
  const currentNoteIdRef = useRef<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  // Last insert failure surfaced from NoteView (e.g. note deleted / view
  // destroyed). Displayed inline in the toolbar; cleared by re-enabling sync.
  const [syncError, setSyncError] = useState<string | null>(null);
  // Transient "switched notes, re-syncing" banner state. Cleared on a
  // timer so it auto-fades once the fresh note catches up.
  const [reSyncing, setReSyncing] = useState(false);

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
        const newNoteId: string | null = msg.payload?.noteId ?? null;
        noteOpenRef.current = open;
        if (t > lastTypedAtRef.current) lastTypedAtRef.current = t;
        // When the active note changes, forget previously synced turns
        // so the new note receives the full conversation history (per
        // the design: "新 note → 从头重新导入").
        if (newNoteId && newNoteId !== currentNoteIdRef.current) {
          const wasFirstBinding = currentNoteIdRef.current === null;
          console.log('[AIWebView Sync] Note switched:', currentNoteIdRef.current, '→', newNoteId, '— resetting dedup state');
          currentNoteIdRef.current = newNoteId;
          syncedResponsesRef.current.clear();
          lastSyncedCountRef.current = 0;
          setSyncCount(0);
          // Show a transient "re-syncing into new note" hint — but only
          // when this is a genuine user-initiated switch, not the very
          // first noteId binding right after sync mode opens.
          if (!wasFirstBinding) {
            setReSyncing(true);
            setTimeout(() => setReSyncing(false), 5000);
          }
        } else if (!currentNoteIdRef.current && newNoteId) {
          currentNoteIdRef.current = newNoteId;
        }
        setNoteOpen(open);
      } else if (msg.protocol === 'ai-sync' && msg.action === 'as:insert-failed') {
        const reason = String(msg.payload?.reason ?? 'unknown');
        console.warn('[AIWebView Sync] Insert failed:', reason);
        setSyncError(reason === 'no-active-note' ? '无可用笔记' : '插入失败');
        // Pause the toggle so we stop sending more turns into the void.
        setSyncEnabled(false);
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
      // Boundary: previous poll still running (e.g. Claude artifact probe takes
      // up to 4 s, longer than the 2 s tick). Skip rather than race.
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;

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
      } finally {
        pollInFlightRef.current = false;
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
      const convId = conv.uuid || 'unknown';
      const synced = getSyncedSet(convId);

      // Pair each human message with the next assistant message; emit
      // any pair whose human uuid we haven't synced yet.
      let turnIdx = synced.size;
      for (let i = 0; i < conv.messages.length; i++) {
        const m = conv.messages[i];
        if (m.sender !== 'human') continue;
        if (synced.has(m.uuid)) continue;

        const humanMsg = m.text;
        let assistantMsg = '';
        for (let j = i + 1; j < conv.messages.length; j++) {
          if (conv.messages[j].sender === 'assistant') {
            assistantMsg = conv.messages[j].text;
            break;
          }
        }

        if (!assistantMsg) {
          // Streaming not finished yet — wait for next poll
          break;
        }

        const idx = turnIdx;

        const finalMarkdown = await processClaudeArtifacts(webview, assistantMsg);

        console.log(`[AIWebView Sync/Claude] Response #${idx}: ${finalMarkdown.length} chars`);

        sendTurn({
          responseId: m.uuid,
          index: idx,
          userMessage: humanMsg,
          markdown: finalMarkdown,
          serviceId: 'claude',
          serviceName,
        });
        synced.add(m.uuid);
        turnIdx += 1;
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
              background: syncError ? '#8b1e1e'
                : !syncEnabled ? '#555'
                : reSyncing ? '#1e5a8a'
                : noteOpen ? '#1b5e20' : '#8a6d3b',
              border: 'none', borderRadius: 4, color: '#fff',
              fontSize: 11, padding: '3px 8px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
            onClick={() => {
              setSyncError(null);
              setSyncEnabled(!syncEnabled);
            }}
            title={
              syncError ? `同步已停止：${syncError}（点击重试）`
              : !syncEnabled ? '恢复同步'
              : reSyncing ? '切换笔记中，正在重新同步历史到新笔记'
              : noteOpen ? '暂停同步'
              : '等待 NoteView 打开'
            }
          >
            <span>{syncError ? '⚠' : !syncEnabled ? '⏸' : reSyncing ? '↻' : noteOpen ? '●' : '⏸'}</span>
            <span>
              {syncError ? `同步失败：${syncError}`
                : !syncEnabled ? '已暂停'
                : reSyncing ? `重新同步 (${syncCount})`
                : noteOpen ? `同步中 (${syncCount})`
                : `等待笔记 (${syncCount})`}
            </span>
          </button>
        )}

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
