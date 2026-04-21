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
import { processClaudeArtifactsLive } from '../../ai-note-bridge';
import '../web.css';

declare const viewAPI: {
  sendToOtherSlot: (message: { protocol: string; action: string; payload: unknown }) => void;
  onMessage: (callback: (message: { protocol: string; action: string; payload: unknown }) => void) => () => void;
  requestCompanion: (workModeId: string) => Promise<void>;
  noteCreate: (title?: string) => Promise<{ id: string; title: string } | null>;
  noteOpenInEditor: (id: string) => Promise<void>;
  noteLoad: (id: string) => Promise<{ id: string; title: string; doc_content: unknown[] } | null>;
  noteList: () => Promise<Array<{ id: string; title: string; folder_id: string | null; updated_at: number }>>;
  getActiveNoteId: () => Promise<string | null>;
  onAIInjectAndSend?: (callback: (params: any) => void) => () => void;
  aiSendResponse?: (channel: string, result: any) => Promise<void>;
  aiReadClipboard: () => Promise<string>;
  aiExtractionCacheWrite: (payload: any) => Promise<{ success: boolean; dir?: string; jsonPath?: string; markdownPath?: string | null; error?: string }>;
  wbCdpStart: (urlFilters?: string[]) => Promise<{ success: boolean; error?: string; guestUrl?: string; guestId?: number; filters?: string[] }>;
  wbCdpStop: () => Promise<{ success: boolean }>;
  wbCdpFindResponse: (params: { urlSubstring: string; mode?: 'all' | 'latest' | 'first' }) =>
    Promise<{ success: boolean; error?: string; count?: number; matches?: Array<{ url: string; statusCode: number; mimeType: string; body: string | null; bodyLength: number; timestamp: number }> }>;
  wbSendMouse: (events: Array<{ type: string; x: number; y: number; button?: string; buttons?: number; clickCount?: number }>) =>
    Promise<{ success: boolean; error?: string; count?: number }>;
  wbSendKey: (events: Array<{ type: string; key: string; code?: string; windowsVirtualKeyCode?: number }>) =>
    Promise<{ success: boolean; error?: string; count?: number }>;
  wbReadClipboardImage: () =>
    Promise<{ success: boolean; empty?: boolean; dataUrl?: string; width?: number; height?: number }>;
  wbFetchBinary: (params: { url: string; headers?: Record<string, string>; timeoutMs?: number }) =>
    Promise<{ success: boolean; base64?: string; mimeType?: string; bodyLength?: number; error?: string }>;
  wbCaptureDownloadOnce: (timeoutMs?: number) => Promise<{
    success: boolean;
    filename?: string;
    mimeType?: string;
    contentBase64?: string;
    byteLength?: number;
    error?: string;
  }>;
  mediaPutBase64: (input: string, mimeType?: string, filename?: string) =>
    Promise<{ success: boolean; mediaUrl?: string; mediaId?: string; error?: string }>;
  wbCaptureIsolatedSegment: (url: string, timeoutMs?: number) => Promise<{
    success: boolean;
    items?: Array<{ index: number; src: string; mimeType: string; contentBase64: string; width: number; height: number }>;
    error?: string;
  }>;
  wbCaptureGuestRects: (rects: Array<{ x: number; y: number; width: number; height: number }>) => Promise<{
    success: boolean;
    items?: Array<{ index: number; mimeType: string; contentBase64: string; width: number; height: number }>;
    error?: string;
  }>;
  browserCapabilityDebugLog: (payload: unknown) => Promise<{ success: boolean; pageId?: string; error?: string }>;
  browserCapabilityExtractTurn: (params: { msgIndex: number }) => Promise<{
    success: boolean;
    index?: number;
    userMessage?: string;
    markdown?: string;
    timestamp?: string;
    artifactCount?: number;
    error?: string;
  }>;
  browserCapabilityExtractFull: () => Promise<{
    success: boolean;
    title?: string;
    model?: string;
    turns?: Array<{
      index: number;
      userMessage: string;
      markdown: string;
      timestamp?: string;
      artifactCount: number;
    }>;
    error?: string;
  }>;
  browserCapabilityProbeConversation: () => Promise<{ success: boolean; error?: string }>;
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
  preview: string;
}

interface ClaudeResolvedTurn {
  userMessage: string;
  baseMarkdown: string;
}

const LAST_SERVICE_KEY = 'krig.ai.lastService';

function normalizePreviewText(input: string): string {
  return (input || '')
    .replace(/\s+/g, ' ')
    .replace(/[`*_>#-]+/g, ' ')
    .trim()
    .toLowerCase();
}

function findClaudeAssistantByPreview(
  conv: Awaited<ReturnType<typeof extractClaudeConversation>>,
  msgIndex: number,
  preview: string,
): { userMessage: string; markdown: string } | null {
  if (!conv) return null;
  const normalizedPreview = normalizePreviewText(preview).slice(0, 120);

  const pairs: Array<{ assistantOrder: number; userMessage: string; markdown: string }> = [];
  let pendingHuman = '';
  let assistantOrder = -1;
  for (const m of conv.messages) {
    if (m.sender === 'human') {
      pendingHuman = m.text;
      continue;
    }
    if (m.sender === 'assistant') {
      assistantOrder += 1;
      pairs.push({
        assistantOrder,
        userMessage: pendingHuman,
        markdown: m.text,
      });
      pendingHuman = '';
    }
  }

  if (normalizedPreview) {
    let best: { idx: number; score: number } | null = null;
    for (let i = 0; i < pairs.length; i++) {
      const candidate = normalizePreviewText(pairs[i].markdown).slice(0, 400);
      if (!candidate) continue;
      let score = 0;
      if (candidate.includes(normalizedPreview)) score = normalizedPreview.length + 1000;
      else if (normalizedPreview.includes(candidate.slice(0, Math.min(candidate.length, 80)))) score = 900 + Math.min(candidate.length, 80);
      else {
        const candidateWords = candidate.split(' ').filter(Boolean);
        const previewWords = new Set(normalizedPreview.split(' ').filter(Boolean));
        for (const word of candidateWords) {
          if (previewWords.has(word)) score += Math.min(word.length, 12);
        }
      }
      if (score <= 0) continue;
      // Small bias toward the DOM-local ordinal when multiple texts are similar.
      score -= Math.abs(i - msgIndex) * 3;
      if (!best || score > best.score) best = { idx: i, score };
    }
    if (best && best.score > 20) {
      return {
        userMessage: pairs[best.idx].userMessage,
        markdown: pairs[best.idx].markdown,
      };
    }
  }

  const fallback = pairs[msgIndex];
  return fallback ? { userMessage: fallback.userMessage, markdown: fallback.markdown } : null;
}

async function resolveClaudeTurnFromApi(
  webview: Electron.WebviewTag,
  msgIndex: number,
  preview: string,
): Promise<ClaudeResolvedTurn | null> {
  const conv = await extractClaudeConversation(webview);
  if (!conv) return null;
  const matched = findClaudeAssistantByPreview(conv, msgIndex, preview);
  if (!matched) return null;
  return {
    userMessage: matched.userMessage,
    baseMarkdown: matched.markdown,
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}
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

async function listClaudeIsolatedSegmentUrls(webview: Electron.WebviewTag): Promise<string[]> {
  try {
    const result = await webview.executeJavaScript(`
      (function() {
        return Array.from(document.querySelectorAll('iframe')).map(function(el) {
          return String(el.getAttribute('src') || el.src || '');
        }).filter(function(src) {
          return src.indexOf('claudemcpcontent.com/mcp_apps') >= 0 ||
            src.indexOf('isolated-segment.html') >= 0;
        });
      })()
    `);
    return Array.isArray(result) ? result.filter((x) => typeof x === 'string' && x) : [];
  } catch {
    return [];
  }
}

export function AIWebView({ workModeId: _workModeId = '' }: AIWebViewProps) {
  void _workModeId; // workModeId is kept for prop-API stability; not used yet.
  const webviewRef = useRef<Electron.WebviewTag | null>(null);
  const [currentService, setCurrentService] = useState<AIServiceId>(loadLastService);
  const [loading, setLoading] = useState(true);
  const [showServiceMenu, setShowServiceMenu] = useState(false);
  const [aiStatus, setAiStatus] = useState<'idle' | 'injecting' | 'waiting' | 'capturing'>('idle');
  const [artifactDownloadBusy, setArtifactDownloadBusy] = useState(false);
  const [artifactDownloadStatus, setArtifactDownloadStatus] = useState('');
  const [isExtractionLocked, setIsExtractionLocked] = useState(false);
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
      function topLevelCards() {
        return Array.from(document.querySelectorAll('[class*="group/artifact-block"]')).filter(function(el) {
          var p = el.parentElement;
          while (p) {
            var cls = '';
            try { cls = (p.className && String(p.className)) || ''; } catch (e) {}
            if (cls.indexOf('group/artifact-block') >= 0) return false;
            p = p.parentElement;
          }
          var buttons = Array.from(el.querySelectorAll('button, [role="button"], a'));
          for (var bi = 0; bi < buttons.length; bi++) {
            var b = buttons[bi];
            var label = ((b.innerText || b.textContent || '') + ' ' +
              (b.getAttribute('aria-label') || '') + ' ' +
              (b.getAttribute('title') || '')).toLowerCase();
            if (label.indexOf('download') >= 0) return true;
          }
          return false;
        });
      }
      var list = [];
      // First pass: collect primary selector matches
      var primaryNodes = document.querySelectorAll(parts[0]);
      for (var k = 0; k < primaryNodes.length; k++) list.push(primaryNodes[k]);
      // Second pass: add secondary selector matches only if they don't
      // overlap with any primary match (ancestor/descendant relationship)
      for (var j = 1; j < parts.length; j++) {
        var nodes = document.querySelectorAll(parts[j]);
        for (var k = 0; k < nodes.length; k++) {
          var isDuplicate = false;
          for (var p = 0; p < list.length; p++) {
            if (list[p].contains(nodes[k]) || nodes[k].contains(list[p])) {
              isDuplicate = true;
              break;
            }
          }
          if (!isDuplicate) {
            // Insert in DOM order
            var inserted = false;
            for (var p = 0; p < list.length; p++) {
              if (list[p].compareDocumentPosition(nodes[k]) & Node.DOCUMENT_POSITION_PRECEDING) {
                list.splice(p, 0, nodes[k]);
                inserted = true;
                break;
              }
            }
            if (!inserted) list.push(nodes[k]);
          }
        }
      }
      if (!hit) {
        var best = null;
        var px = ${x};
        var py = ${y};
        for (var n = 0; n < list.length; n++) {
          var rect = list[n].getBoundingClientRect();
          var dx = 0;
          if (px < rect.left) dx = rect.left - px;
          else if (px > rect.right) dx = px - rect.right;
          var dy = 0;
          if (py < rect.top) dy = rect.top - py;
          else if (py > rect.bottom) dy = py - rect.bottom;
          var insideYBand = py >= rect.top - 24 && py <= rect.bottom + 24;
          var score = dy * 1000 + dx;
          if (!insideYBand && dy > 240) continue;
          if (!best || score < best.score) best = { node: list[n], score: score };
        }
        hit = best ? best.node : null;
      }
      if (!hit) return { index: -1, preview: '', total: list.length, artifactOrdinal: null };
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
      function isClaudeArtifactIframe(node) {
        if (!node || node.tagName !== 'IFRAME') return false;
        var src = String(node.getAttribute('src') || node.src || '');
        if (!src) return false;
        if (src.indexOf('claudemcpcontent.com/mcp_apps') < 0 &&
            src.indexOf('isolated-segment.html') < 0) return false;
        var rect = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
        if (rect && rect.width <= 2 && rect.height <= 2) return false;
        return true;
      }
      var cards = topLevelCards();
      var allIframes = Array.from(document.querySelectorAll('iframe')).filter(isClaudeArtifactIframe);
      var merged = cards.map(function(node) { return { form: 'card', el: node }; })
        .concat(allIframes.map(function(node) { return { form: 'iframe', el: node }; }));
      merged.sort(function(a, b) {
        var rel = a.el.compareDocumentPosition(b.el);
        if (rel & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (rel & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });
      var artifactEl = null;
      if (el) {
        if (isClaudeArtifactIframe(el)) artifactEl = el;
        if (!artifactEl && el.closest) artifactEl = el.closest('[class*="group/artifact-block"]');
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
          preview: typeof r.preview === 'string' ? r.preview : '',
        };
      }
      return { msgIndex: -1, artifactOrdinal: null, preview: '' };
    } catch {
      return { msgIndex: -1, artifactOrdinal: null, preview: '' };
    }
  }, []);

  const clearTargetMarker = useCallback(async (webview: Electron.WebviewTag) => {
    try {
      await webview.executeJavaScript(
        `(function(){var s=document.querySelectorAll('[data-krig-target]');for(var i=0;i<s.length;i++){s[i].removeAttribute('data-krig-target');s[i].removeAttribute('data-krig-click-x');s[i].removeAttribute('data-krig-click-y');}})()`,
      );
    } catch {}
  }, []);

  const probeClaudeArtifactsInScope = useCallback(async (webview: Electron.WebviewTag, expectedCount = 0) => {
    try {
      const script = `
        (async function() {
          var scope = document.querySelector('[data-krig-target="1"]');
          var expectedCount = ${Math.max(0, expectedCount)};
          function findNearestHeadingText(node) {
            var cur = node;
            while (cur) {
              var prev = cur.previousElementSibling;
              while (prev) {
                var heading = prev.matches && prev.matches('h1,h2,h3,h4,h5,h6,[role="heading"]')
                  ? prev
                  : (prev.querySelector ? prev.querySelector('h1,h2,h3,h4,h5,h6,[role="heading"]') : null);
                if (heading) {
                  var txt = (heading.innerText || heading.textContent || '').replace(/\\s+/g, ' ').trim();
                  if (txt) return txt.slice(0, 160);
                }
                prev = prev.previousElementSibling;
              }
              cur = cur.parentElement;
              if (scope && cur === scope.parentElement) break;
            }
            return '';
          }
          function collectSiblingText(node, dir) {
            var out = [];
            var cur = node;
            for (var steps = 0; cur && steps < 8 && out.length < 3; steps++) {
              cur = dir < 0 ? cur.previousElementSibling : cur.nextElementSibling;
              if (!cur) break;
              var txt = (cur.innerText || cur.textContent || '').replace(/\\s+/g, ' ').trim();
              if (!txt) continue;
              if (txt.length > 220) {
                txt = dir < 0 ? txt.slice(-220) : txt.slice(0, 220);
              }
              out.push(txt);
            }
            return out;
          }
          function sampleNearbyText(node) {
            var prevParts = collectSiblingText(node, -1);
            var nextParts = collectSiblingText(node, 1);
            return {
              prevText: prevParts.join(' || '),
              nextText: nextParts.join(' || '),
            };
          }
          function summarizeEl(el) {
            if (!el) return null;
            var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
            var cls = '';
            try { cls = (el.className && String(el.className)) || ''; } catch (e) {}
            return {
              tag: (el.tagName || '').toLowerCase(),
              text: ((el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim()).slice(0, 120),
              ariaLabel: el.getAttribute ? (el.getAttribute('aria-label') || '') : '',
              title: el.getAttribute ? (el.getAttribute('title') || '') : '',
              role: el.getAttribute ? (el.getAttribute('role') || '') : '',
              className: cls.slice(0, 240),
              rect: rect ? {
                top: Math.round(rect.top),
                bottom: Math.round(rect.bottom),
                left: Math.round(rect.left),
                right: Math.round(rect.right),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              } : null,
            };
          }
          function ancestorChain(el, stopAt) {
            var out = [];
            var cur = el;
            for (var i = 0; cur && i < 8; i++) {
              out.push(summarizeEl(cur));
              if (cur === stopAt) break;
              cur = cur.parentElement;
            }
            return out;
          }
          function topLevelCards() {
            return Array.from(document.querySelectorAll('[class*="group/artifact-block"]')).filter(function(el) {
              var p = el.parentElement;
          while (p) {
            var cls = '';
            try { cls = (p.className && String(p.className)) || ''; } catch (e) {}
            if (cls.indexOf('group/artifact-block') >= 0) return false;
            p = p.parentElement;
          }
          var buttons = Array.from(el.querySelectorAll('button, [role="button"], a'));
          for (var bi = 0; bi < buttons.length; bi++) {
            var b = buttons[bi];
            var label = ((b.innerText || b.textContent || '') + ' ' +
              (b.getAttribute('aria-label') || '') + ' ' +
              (b.getAttribute('title') || '')).toLowerCase();
            if (label.indexOf('download') >= 0) return true;
          }
          return false;
        });
          }
          function buildMerged() {
            function isClaudeArtifactIframe(node) {
              if (!node || node.tagName !== 'IFRAME') return false;
              var src = String(node.getAttribute('src') || node.src || '');
              if (!src) return false;
              if (src.indexOf('claudemcpcontent.com/mcp_apps') < 0 &&
                  src.indexOf('isolated-segment.html') < 0) return false;
              var rect = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
              if (rect && rect.width <= 2 && rect.height <= 2) return false;
              return true;
            }
            var cards = topLevelCards();
            var allIframes = Array.from(document.querySelectorAll('iframe')).filter(isClaudeArtifactIframe);
            var merged = cards.map(function(el) { return { form: 'card', el: el }; })
              .concat(allIframes.map(function(el) { return { form: 'iframe', el: el }; }));
            merged.sort(function(a, b) {
              var rel = a.el.compareDocumentPosition(b.el);
              if (rel & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
              if (rel & Node.DOCUMENT_POSITION_PRECEDING) return 1;
              return 0;
            });
            return merged;
          }
          // Mirror the current Claude enumeration path:
          // top-level download cards + artifact iframes (mcp_apps / legacy isolated-segment),
          // merged in document order.
          var merged = buildMerged();
          var allIframeDebug = Array.from(document.querySelectorAll('iframe')).map(function(el, idx) {
            var rect = el.getBoundingClientRect();
            return {
              idx: idx,
              src: String(el.getAttribute('src') || el.src || ''),
              className: String((el.className && String(el.className)) || '').slice(0, 240),
              top: Math.round(rect.top),
              bottom: Math.round(rect.bottom),
              height: Math.round(rect.height),
              width: Math.round(rect.width),
            };
          });
          return {
            entries: merged.map(function(entry, ordinal) {
            var rect = entry.el.getBoundingClientRect();
            var titleEl = entry.form === 'card'
              ? entry.el.querySelector('[class*="font-medium"], [data-testid="artifact-title"]')
              : null;
            var kindEl = entry.form === 'card'
              ? entry.el.querySelector('[class*="text-text-300"], [data-testid="artifact-kind"]')
              : null;
            var buttons = entry.form === 'card'
              ? Array.from(entry.el.querySelectorAll('button, [role="button"], a'))
              : [];
            var downloadBtn = null;
            for (var bi = 0; bi < buttons.length; bi++) {
              var b = buttons[bi];
              var label = ((b.innerText || b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '')).toLowerCase();
              if (label.indexOf('download') >= 0) { downloadBtn = b; break; }
            }
            if (!downloadBtn && buttons.length > 0) downloadBtn = buttons[0];
            var btnRect = downloadBtn && downloadBtn.getBoundingClientRect ? downloadBtn.getBoundingClientRect() : null;
            var nearby = sampleNearbyText(entry.el);
            return {
              ordinal: ordinal,
              form: entry.form,
              inScope: scope ? scope.contains(entry.el) : false,
              visible: rect.bottom > -20 && rect.top < (window.innerHeight || 0) + 20,
              top: Math.round(rect.top),
              bottom: Math.round(rect.bottom),
              height: Math.round(rect.height),
              title: titleEl ? (titleEl.textContent || '').trim() : '',
              kind: kindEl ? (kindEl.textContent || '').trim() : '',
              nearestHeading: findNearestHeadingText(entry.el),
              prevText: nearby.prevText,
              nextText: nearby.nextText,
              downloadButton: btnRect ? {
                text: (downloadBtn.innerText || downloadBtn.textContent || '').replace(/\\s+/g, ' ').trim(),
                ariaLabel: downloadBtn.getAttribute('aria-label') || '',
                title: downloadBtn.getAttribute('title') || '',
                top: Math.round(btnRect.top),
                bottom: Math.round(btnRect.bottom),
                left: Math.round(btnRect.left),
                right: Math.round(btnRect.right),
              } : null,
              actions: buttons.map(function(btn) { return summarizeEl(btn); }).slice(0, 12),
              cardSummary: summarizeEl(entry.el),
              buttonAncestors: downloadBtn ? ancestorChain(downloadBtn, entry.el) : [],
            };
          }),
            iframeDebug: allIframeDebug,
          };
        })()
      `;
      const result = await withTimeout(webview.executeJavaScript(script), 5_000, 'probeClaudeArtifactsInScope');
      if (Array.isArray(result)) return result;
      if (result && Array.isArray(result.entries)) {
        try {
          await viewAPI.aiExtractionCacheWrite({
            extractionId: `probe-debug-${Date.now()}`,
            stage: 'artifact-probe-iframes',
            serviceId: 'claude',
            markdown: '',
            meta: {
              iframeDebug: result.iframeDebug || [],
            },
          });
        } catch {}
        return result.entries;
      }
      return [];
    } catch {
      return [];
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
      console.log('[AIWebView Extract] start', {
        serviceId: profile.id,
        msgIndex,
        artifactOrdinal: (ctx as MenuContext & { artifactOrdinal?: number | null }).artifactOrdinal ?? null,
        preview: (ctx as MenuContext & { preview?: string }).preview || '',
      });
      setIsExtractionLocked(true);
      await viewAPI.requestCompanion('demo-a');
      const extractionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Gemini needs CDP to see the batchexecute response.
      // ChatGPT only needs CDP as fallback (Browser Capability probe is primary).
      if (profile.id === 'gemini' && !cdpStartedRef.current) {
        const r = await viewAPI.wbCdpStart(['rpcids=']);
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
        // Try browser-capability extraction first (has full artifact content)
        const capResult = await viewAPI.browserCapabilityExtractTurn({ msgIndex });
        if (capResult.success && capResult.markdown) {
          userMessage = capResult.userMessage ?? '';
          markdown = capResult.markdown;
          console.log('[AIWebView Extract] capability-based extraction succeeded', {
            msgIndex,
            artifactCount: capResult.artifactCount,
          });
        } else {
          // Fallback: API extraction without artifact content
          console.log('[AIWebView Extract] capability fallback to API extraction', {
            msgIndex,
            capError: capResult.error,
          });
          const resolvedTurn = await resolveClaudeTurnFromApi(
            webview,
            msgIndex,
            (ctx as MenuContext & { preview?: string }).preview || '',
          );
          if (!resolvedTurn) return;
          userMessage = resolvedTurn.userMessage;
          markdown = resolvedTurn.baseMarkdown;
          markdown = processClaudeArtifactsLive(markdown, url);
        }
      } else if (profile.id === 'chatgpt') {
        // Browser Capability extraction: probe → extract (no CDP needed)
        await viewAPI.browserCapabilityProbeConversation();
        const capResult = await viewAPI.browserCapabilityExtractTurn({ msgIndex });
        if (capResult.success && capResult.markdown) {
          userMessage = capResult.userMessage ?? '';
          markdown = capResult.markdown;
          console.log('[AIWebView Extract] ChatGPT capability-based extraction succeeded', {
            msgIndex,
            artifactCount: capResult.artifactCount,
          });
        } else {
          // Fallback: CDP-based extraction (legacy)
          console.log('[AIWebView Extract] ChatGPT capability failed, falling back to CDP', {
            msgIndex,
            capError: capResult.error,
          });
          const c = await extractChatGPTContent(webview, viewAPI as any);
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

      await viewAPI.aiExtractionCacheWrite({
        extractionId,
        stage: 'final-before-send',
        serviceId: profile.id,
        url,
        msgIndex,
        preview: (ctx as MenuContext & { preview?: string }).preview || '',
        userMessage,
        markdown,
        meta: {
          artifactOrdinal: (ctx as MenuContext & { artifactOrdinal?: number | null }).artifactOrdinal ?? null,
        },
      }).catch(() => {});

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
          debug: {
            extractionId,
          },
        },
      });
      await viewAPI.aiExtractionCacheWrite({
        extractionId,
        stage: 'final-after-send',
        serviceId: profile.id,
        url,
        msgIndex,
        preview: (ctx as MenuContext & { preview?: string }).preview || '',
        userMessage,
        markdown,
        meta: {
          artifactOrdinal: (ctx as MenuContext & { artifactOrdinal?: number | null }).artifactOrdinal ?? null,
        },
      }).catch(() => {});
    } catch (err) {
      console.warn('[AIWebView Extract] Failed:', err);
    } finally {
      setIsExtractionLocked(false);
    }
  }, [probeClaudeArtifactsInScope]);

  const aiContextItems = useMemo<ContextMenuItem[]>(() => [
    {
      id: 'extract-to-note',
      icon: '📥',
      label: '提取到笔记',
      visible: (ctx: MenuContext) => !!detectAIServiceByUrl(ctx.url),
      onClick: async (ctx: MenuContext) => {
        const profile = detectAIServiceByUrl(ctx.url);
        if (!profile) return;
        const extractionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await viewAPI.aiExtractionCacheWrite({
          extractionId,
          stage: 'menu-click',
          serviceId: profile.id,
          url: ctx.url,
          msgIndex: -1,
          preview: '',
          userMessage: '',
          markdown: '',
          meta: {
            x: ctx.x,
            y: ctx.y,
          },
        }).catch(() => {});
        console.log('[AIWebView Extract] resolve-start', {
          serviceId: profile.id,
          x: ctx.x,
          y: ctx.y,
          url: ctx.url,
        });
        const target = await resolveMsgIndex(ctx.webview, ctx.x, ctx.y, profile.selectors.assistantMessage);
        console.log('[AIWebView Extract] resolve-done', {
          serviceId: profile.id,
          msgIndex: target.msgIndex,
          artifactOrdinal: target.artifactOrdinal,
          preview: target.preview,
        });
        await viewAPI.aiExtractionCacheWrite({
          extractionId,
          stage: 'resolve-done',
          serviceId: profile.id,
          url: ctx.url,
          msgIndex: target.msgIndex,
          preview: target.preview,
          userMessage: '',
          markdown: '',
          meta: {
            artifactOrdinal: target.artifactOrdinal,
          },
        }).catch(() => {});
        if (target.msgIndex < 0) {
          await viewAPI.aiExtractionCacheWrite({
            extractionId,
            stage: 'resolve-miss',
            serviceId: profile.id,
            url: ctx.url,
            msgIndex: target.msgIndex,
            preview: target.preview,
            userMessage: '',
            markdown: '',
            meta: {
              artifactOrdinal: target.artifactOrdinal,
            },
          }).catch(() => {});
          console.warn('[AIWebView Extract] Right-click was not inside an assistant message');
          return;
        }
        await extractTurnAt(
          { ...ctx, artifactOrdinal: target.artifactOrdinal, preview: target.preview } as MenuContext & { artifactOrdinal?: number | null; preview?: string },
          target.msgIndex,
        );
      },
    },
  ], [resolveMsgIndex, extractTurnAt]);

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

            // SSE 检测到 AI 回复结束 → 强制刷新 conversation.json → 提取 → 校验 artifact 完整性
            setAiStatus('capturing');
            try {
              const lastAssistantIdx = await webview!.executeJavaScript(`(function() {
                var selector = ${JSON.stringify(profile.selectors.assistantMessage)};
                var parts = selector.split(',').map(function(s) { return s.trim(); });
                var count = 0;
                for (var i = 0; i < parts.length; i++) count += document.querySelectorAll(parts[i]).length;
                return count - 1;
              })()`);
              if (lastAssistantIdx < 0) throw new Error('No assistant message found');

              // 1. 强制重新 fetch conversation API，确保 conversation.json 包含最新回复
              console.log('[AI_INJECT] Step: force probe conversation API');
              await viewAPI.browserCapabilityProbeConversation();

              // 2. 提取 + 校验 artifact 完整性，最多重试 3 次
              let markdown = '';
              const MAX_RETRIES = 3;
              for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                console.log('[AI_INJECT] Extraction attempt', attempt, 'msgIndex:', lastAssistantIdx);
                const capResult = await viewAPI.browserCapabilityExtractTurn({ msgIndex: lastAssistantIdx });
                console.log('[AI_INJECT] capResult:', capResult.success, 'mdLen:', capResult.markdown?.length ?? 0, 'artifactCount:', capResult.artifactCount ?? 0, 'error:', capResult.error);

                if (capResult.success && capResult.markdown) {
                  // 检查 artifact 完整性：是否有未提取到内容的占位符
                  const hasPlaceholder = capResult.markdown.includes('artifact 内容不可用')
                    || capResult.markdown.includes('This block is not supported');

                  if (!hasPlaceholder || attempt >= MAX_RETRIES) {
                    markdown = capResult.markdown;
                    if (hasPlaceholder && attempt >= MAX_RETRIES) {
                      console.warn('[AI_INJECT] Artifact content still incomplete after', MAX_RETRIES, 'retries, using partial result');
                    }
                    break;
                  }
                  // artifact 内容不完整 → 等待后重新 probe + 重试
                  console.log('[AI_INJECT] Artifact content incomplete, retrying in 2s... (attempt', attempt + 1, ')');
                  await new Promise(r => setTimeout(r, 2000));
                  await viewAPI.browserCapabilityProbeConversation();
                } else if (attempt >= MAX_RETRIES) {
                  // 所有重试都失败 → fallback 到 API 文本提取
                  console.log('[AI_INJECT] Capability extraction failed after retries, fallback to API');
                  const curUrl = webview!.getURL?.() || '';
                  const resolvedTurn = await resolveClaudeTurnFromApi(
                    webview!, lastAssistantIdx, '',
                  );
                  if (resolvedTurn) {
                    markdown = resolvedTurn.baseMarkdown;
                    markdown = processClaudeArtifactsLive(markdown, curUrl);
                  }
                } else {
                  // 提取失败但还有重试机会 → 等待后重试
                  console.log('[AI_INJECT] Extraction failed, retrying in 2s... (attempt', attempt + 1, ')');
                  await new Promise(r => setTimeout(r, 2000));
                  await viewAPI.browserCapabilityProbeConversation();
                }
              }
              console.log('[AI_INJECT] Final markdown length:', markdown.length);

              // 发回 main 进程 → 保存到 ThoughtStore
              setAiStatus('idle');
              viewAPI.aiSendResponse?.(params.responseChannel, {
                success: !!markdown.trim(),
                markdown: markdown || undefined,
                error: markdown.trim() ? undefined : 'extraction returned empty',
              });
            } catch (exErr) {
              setAiStatus('idle');
              console.warn('[AI_INJECT_AND_SEND] extraction failed:', exErr);
              viewAPI.aiSendResponse?.(params.responseChannel, { success: false, error: String(exErr) });
            }
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

  const triggerFullConversationExtract = useCallback(async () => {
    setArtifactDownloadBusy(true);
    setArtifactDownloadStatus('提取整页对话...');
    try {
      await viewAPI.requestCompanion('demo-a');
      // Ensure conversation data is fresh before extraction
      await viewAPI.browserCapabilityProbeConversation();
      const result = await viewAPI.browserCapabilityExtractFull();
      if (!result.success || !result.turns || result.turns.length === 0) {
        setArtifactDownloadStatus(result.error || '未能提取到对话内容');
        return;
      }

      // Send each turn via as:import-conversation
      const webview = webviewRef.current;
      const url = webview?.getURL?.() ?? '';
      const profile = detectAIServiceByUrl(url);

      viewAPI.sendToOtherSlot({
        protocol: 'ai-sync',
        action: 'as:import-conversation',
        payload: {
          title: result.title ?? '未命名对话',
          turns: result.turns,
          source: {
            serviceId: profile?.id ?? 'claude',
            serviceName: profile?.name ?? 'Claude',
            url,
          },
          metadata: {
            model: result.model,
          },
        },
      });

      const totalArtifacts = result.turns.reduce((sum: number, t: any) => sum + (t.artifactCount || 0), 0);
      setArtifactDownloadStatus(
        `已提取 ${result.turns.length} 条回复，${totalArtifacts} 个 artifact`,
      );
    } catch (err) {
      setArtifactDownloadStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setArtifactDownloadBusy(false);
    }
  }, []);

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
        {artifactDownloadStatus && (
          <span style={{ color: '#8ab4f8', fontSize: 12 }}>{artifactDownloadStatus}</span>
        )}

        <div style={{ flex: 1 }} />

        {(currentService === 'claude' || currentService === 'chatgpt' || currentService === 'gemini') && (
          <button
            style={{
              background: artifactDownloadBusy ? '#2d4a7a' : '#1f3b64',
              border: '1px solid #335a92',
              borderRadius: 6,
              color: '#e8eaed',
              fontSize: 12,
              padding: '4px 10px',
              cursor: artifactDownloadBusy ? 'default' : 'pointer',
              opacity: artifactDownloadBusy ? 0.7 : 1,
            }}
            onClick={() => { if (!artifactDownloadBusy) void triggerFullConversationExtract(); }}
            title="提取整个对话（含所有 artifact）到 Note"
            disabled={artifactDownloadBusy}
          >
            {artifactDownloadBusy ? '提取中...' : '提取整页对话'}
          </button>
        )}

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
        {isExtractionLocked && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 20,
              background: 'rgba(18, 18, 18, 0.22)',
              backdropFilter: 'blur(1px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'auto',
              cursor: 'progress',
            }}
            onContextMenu={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onMouseUp={(e) => e.preventDefault()}
            onWheel={(e) => e.preventDefault()}
          >
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 10,
                background: 'rgba(24, 24, 24, 0.92)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: 'rgba(255,255,255,0.92)',
                fontSize: 13,
                lineHeight: 1.4,
                boxShadow: '0 10px 30px rgba(0,0,0,0.28)',
                userSelect: 'none',
              }}
            >
              正在提取 Artifact，请稍候…
            </div>
          </div>
        )}
        <WebViewContextMenu webviewRef={webviewRef} items={aiContextItems} />
      </div>
    </div>
  );
}
