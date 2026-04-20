import { webContents as electronWebContents, type WebContents } from 'electron';
import type { DomAnchor, PageInteraction } from './types';
import type { BrowserOwner, BrowserState, BrowserVisibility, FrameState, ReadyState } from './types';
import { browserCapabilityTraceWriter } from './persistence';
import {
  BrowserCoreService,
  BrowserStateService,
  LeaseManager,
  LifecycleMonitor,
  PageRegistry,
} from './core';
import { NetworkEventBus } from './network';
import { attachSessionNetworkCapture } from './network';
import { attachResponseBodyProviders } from './network';

type BindPageInput = {
  owner: BrowserOwner;
  visibility?: BrowserVisibility;
  partition?: string;
};

type BindingRecord = {
  pageId: string;
};

const lifecycleMonitor = new LifecycleMonitor();
const pageRegistry = new PageRegistry(lifecycleMonitor);
const leaseManager = new LeaseManager(pageRegistry);
const stateService = new BrowserStateService(pageRegistry, leaseManager);
const coreService = new BrowserCoreService(lifecycleMonitor);
const networkService = new NetworkEventBus();

const bindings = new Map<number, BindingRecord>();
const anchorRefreshTimers = new Map<number, ReturnType<typeof setTimeout>[]>();

function buildMainFrame(webContents: WebContents): FrameState {
  const url = safeGetURL(webContents);
  const routingFrameId = webContents.mainFrame?.routingId
    ? String(webContents.mainFrame.routingId)
    : null;
  return {
    frameId: routingFrameId ?? `frame:${webContents.id}:main`,
    parentFrameId: null,
    url,
    origin: safeGetOrigin(url),
    visible: true,
    bounds: null,
    kind: 'main',
  };
}

function safeGetURL(webContents: WebContents): string {
  try {
    return webContents.getURL() || '';
  } catch {
    return '';
  }
}

function safeGetTitle(webContents: WebContents): string {
  try {
    return webContents.getTitle() || '';
  } catch {
    return '';
  }
}

function safeGetOrigin(url: string): string {
  if (!url) return '';
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

function toRect(value: unknown): { x: number; y: number; width: number; height: number } | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  return {
    x: Number(record.x) || 0,
    y: Number(record.y) || 0,
    width: Number(record.width) || 0,
    height: Number(record.height) || 0,
  };
}

function updateSnapshot(
  webContents: WebContents,
  patch: Partial<Omit<BrowserState, 'pageId' | 'frames' | 'downloads' | 'capturedAt'>>,
  readyState?: ReadyState,
): void {
  const pageId = getPageIdForWebContents(webContents);
  if (!pageId) return;
  const currentState = pageRegistry.getPageState(pageId);
  const resolvedUrl = typeof patch.url === 'string'
    ? patch.url
    : currentState?.url || safeGetURL(webContents);
  pageRegistry.updatePage(pageId, {
    title: safeGetTitle(webContents),
    url: resolvedUrl,
    ...patch,
    ...(readyState ? { readyState } : {}),
  });
  const frames = [{
    ...buildMainFrame(webContents),
    url: resolvedUrl,
    origin: safeGetOrigin(resolvedUrl),
  }];
  pageRegistry.setFrames(pageId, frames);
  browserCapabilityTraceWriter.updateFrameSnapshot(pageId, frames);
}

async function captureVisibleSurface(
  webContents: WebContents,
): Promise<{ anchors: DomAnchor[]; interactions: PageInteraction[] }> {
  const pageId = getPageIdForWebContents(webContents);
  if (!pageId || webContents.isDestroyed()) return { anchors: [], interactions: [] };
  try {
    const snapshot = await webContents.executeJavaScript(`
      (() => {
        const rectOf = (el) => {
          const rect = el.getBoundingClientRect();
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          };
        };
        const textOf = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.textContent || '').trim().slice(0, 160);
        const iframes = Array.from(document.querySelectorAll('iframe'));
        const anchors = iframes.map((el, index) => {
          const src = typeof el.src === 'string' ? el.src : '';
          const rect = rectOf(el);
          const inViewportBand = rect.bottom > -64 && rect.top < (window.innerHeight + 64);
          const visible = rect.width > 0 && rect.height > 0 && inViewportBand;
          const title = el.getAttribute('title') || el.getAttribute('aria-label') || '';
          return {
            anchorId: 'anchor:iframe:' + (index + 1),
            selectorHint: 'iframe',
            textPreview: title || src || undefined,
            rect,
            role: 'iframe',
            headingPath: [],
            ordinal: index + 1,
            visible,
            frameUrl: src || undefined,
            frameOrigin: (() => {
              try {
                return src ? new URL(src).origin : undefined;
              } catch {
                return undefined;
              }
            })(),
          };
        }).filter((anchor) => anchor.visible);
        const interactiveSelector = 'button, a[href], input, textarea, select, summary, [role="button"], [role="link"], [role="textbox"], [contenteditable="true"]';
        const interactions = Array.from(document.querySelectorAll(interactiveSelector)).map((el, index) => {
          const rect = rectOf(el);
          const visible = rect.width > 0 && rect.height > 0;
          const tag = el.tagName.toLowerCase();
          const role = el.getAttribute('role') || tag;
          const disabled = !!(el.disabled || el.getAttribute('aria-disabled') === 'true');
          let kind = 'click';
          if (tag === 'input' || tag === 'textarea' || el.getAttribute('contenteditable') === 'true') kind = 'input';
          else if (tag === 'select') kind = 'select';
          else if (tag === 'a') kind = 'navigate';
          else if (tag === 'summary') kind = 'toggle';
          let surfaceScope = 'global';
          if (el.closest('aside, nav')) surfaceScope = 'sidebar';
          else if (el.closest('form') || /write your prompt|send message|use voice mode|add files|sonnet|opus|haiku/i.test(textOf(el))) surfaceScope = 'composer';
          else if (el.closest('header') || rect.y < 80) surfaceScope = 'header';
          else if (el.closest('article, [data-testid*="message"], [class*="message"]')) surfaceScope = 'message';
          return {
            interactionId: 'interaction:' + tag + ':' + (index + 1),
            anchorId: undefined,
            kind,
            surfaceScope,
            role,
            label: textOf(el) || undefined,
            selectorHint: tag,
            textPreview: textOf(el) || undefined,
            rect,
            visible,
            enabled: !disabled,
          };
        }).filter((item) => item.visible);
        return { anchors, interactions };
      })();
    `, true);
    const rawAnchors: Array<Record<string, unknown>> = Array.isArray(snapshot?.anchors) ? snapshot.anchors : [];
    const rawInteractions: Array<Record<string, unknown>> = Array.isArray(snapshot?.interactions) ? snapshot.interactions : [];
    const anchors = rawAnchors.map((anchor: Record<string, unknown>, index: number) => ({
      anchorId: typeof anchor?.anchorId === 'string' ? anchor.anchorId : `anchor:iframe:${index + 1}`,
      pageId,
      frameId: null,
      frameUrl: typeof anchor?.frameUrl === 'string' ? anchor.frameUrl : undefined,
      frameOrigin: typeof anchor?.frameOrigin === 'string' ? anchor.frameOrigin : undefined,
      selectorHint: typeof anchor?.selectorHint === 'string' ? anchor.selectorHint : 'iframe',
      textPreview: typeof anchor?.textPreview === 'string' ? anchor.textPreview : undefined,
      rect: toRect(anchor?.rect),
      role: typeof anchor?.role === 'string' ? anchor.role : 'iframe',
      headingPath: [],
      ordinal: typeof anchor?.ordinal === 'number' ? anchor.ordinal : index + 1,
      visible: anchor?.visible !== false,
    }));
    const interactions: PageInteraction[] = rawInteractions.map((interaction: Record<string, unknown>, index: number) => ({
      interactionId: typeof interaction?.interactionId === 'string' ? interaction.interactionId : `interaction:${index + 1}`,
      pageId,
      anchorId: typeof interaction?.anchorId === 'string' ? interaction.anchorId : undefined,
      frameId: null,
      kind: (() => {
        const kind = interaction?.kind;
        return kind === 'input' || kind === 'select' || kind === 'navigate' || kind === 'toggle' || kind === 'unknown'
          ? kind
          : 'click';
      })(),
      surfaceScope: (() => {
        const scope = interaction?.surfaceScope;
        return scope === 'artifact' || scope === 'composer' || scope === 'sidebar' || scope === 'header' || scope === 'message' || scope === 'unknown'
          ? scope
          : 'global';
      })(),
      role: typeof interaction?.role === 'string' ? interaction.role : undefined,
      label: typeof interaction?.label === 'string' ? interaction.label : undefined,
      selectorHint: typeof interaction?.selectorHint === 'string' ? interaction.selectorHint : undefined,
      textPreview: typeof interaction?.textPreview === 'string' ? interaction.textPreview : undefined,
      rect: toRect(interaction?.rect),
      visible: interaction?.visible !== false,
      enabled: interaction?.enabled !== false,
    }));
    return { anchors, interactions };
  } catch {
    return { anchors: [], interactions: [] };
  }
}

function clearAnchorRefreshTimers(webContentsId: number): void {
  const timers = anchorRefreshTimers.get(webContentsId);
  if (!timers) return;
  for (const timer of timers) {
    clearTimeout(timer);
  }
  anchorRefreshTimers.delete(webContentsId);
}

/**
 * 当检测到 Claude 对话页面时，主动 fetch conversation API 以获取完整对话数据。
 * 解决：用户已在对话页面时 SPA 不会重新请求 API，导致 conversation.json 缺失的问题。
 *
 * @param force 强制重新 fetch，即使 conversation.json 已存在（用于 SSE 结束后刷新数据）
 */
async function probeClaudeConversation(webContents: WebContents, force = false): Promise<void> {
  const pageId = getPageIdForWebContents(webContents);
  if (!pageId || webContents.isDestroyed()) return;

  const url = safeGetURL(webContents);
  if (!url.includes('claude.ai/chat/')) return;

  // 如果已经有 conversation.json 且非强制模式，跳过
  if (!force && browserCapabilityTraceWriter.hasExtractedFile(pageId, 'conversation.json')) return;

  try {
    const result = await webContents.executeJavaScript(`
      (async () => {
        try {
          const url = window.location.href;
          const chatMatch = url.match(/\\/chat\\/([^/?#]+)/);
          if (!chatMatch) return null;
          const conversationId = chatMatch[1];

          // 从已有 API 请求中推断 org ID
          const orgMatch = document.cookie.match(/lastActiveOrg=([^;]+)/)
            || document.querySelector('meta[name="organization-id"]')?.content;
          let orgId = null;

          // 从页面中的 API URL 推断
          const scripts = document.querySelectorAll('script[src*="claude.ai"]');
          // 更可靠的方式：从 fetch 拦截或已有请求中获取
          // 直接尝试从 URL 路径中获取
          const apiLinks = document.querySelectorAll('a[href*="/api/organizations/"]');
          if (apiLinks.length > 0) {
            const m = apiLinks[0].href.match(/\\/organizations\\/([^/]+)/);
            if (m) orgId = m[1];
          }

          // 如果从 DOM 找不到，尝试从 performance entries 中找
          if (!orgId) {
            const entries = performance.getEntriesByType('resource');
            for (const entry of entries) {
              const m = entry.name.match(/claude\\.ai\\/api\\/organizations\\/([0-9a-f-]{36})/);
              if (m) { orgId = m[1]; break; }
            }
          }

          if (!orgId) return null;

          const apiUrl = '/api/organizations/' + orgId + '/chat_conversations/' + conversationId
            + '?tree=True&rendering_mode=messages&render_all_tools=true';
          const resp = await fetch(apiUrl, { credentials: 'include' });
          if (!resp.ok) return null;
          const text = await resp.text();
          return { apiUrl, text, status: resp.status };
        } catch (e) {
          return null;
        }
      })()
    `);

    if (!result?.text) return;

    const bodyBytes = Buffer.from(result.text, 'utf8');
    browserCapabilityTraceWriter.writeResponseBody({
      pageId,
      requestId: `probe:conversation:${Date.now()}`,
      url: `https://claude.ai${result.apiUrl}`,
      method: 'GET',
      status: result.status,
      mimeType: 'application/json',
      resourceType: 'xhr',
      body: bodyBytes,
    });
  } catch {
    // 注入失败（页面已销毁、跨域等），静默忽略
  }
}

/**
 * ChatGPT 页面 probe：注入脚本获取 Bearer token + fetch conversation API。
 *
 * 流程：
 *   1. fetch('/api/auth/session') → accessToken
 *   2. 用 Bearer token fetch('/backend-api/conversation/{uuid}')
 *   3. 结果通过 writeResponseBody 写入 trace-writer → conversation.json
 *
 * 同时获取 textdocs（Canvas）数据。
 */
async function probeChatGPTConversation(webContents: WebContents, force = false): Promise<void> {
  const pageId = getPageIdForWebContents(webContents);
  if (!pageId || webContents.isDestroyed()) return;

  const url = safeGetURL(webContents);
  if (!url.includes('chatgpt.com/c/') && !url.includes('chat.openai.com/c/')) return;

  // 如果已经有 conversation.json 且非强制模式，跳过
  if (!force && browserCapabilityTraceWriter.hasExtractedFile(pageId, 'conversation.json')) return;

  try {
    const result = await webContents.executeJavaScript(`
      (async () => {
        try {
          // 1. 从 URL 提取 conversation UUID
          const urlMatch = window.location.href.match(/\\/c\\/([a-f0-9-]{36})/);
          if (!urlMatch) return { error: 'no-conversation-id' };
          const conversationId = urlMatch[1];

          // 2. 获取 Bearer token
          let accessToken = null;
          try {
            const sessionResp = await fetch('/api/auth/session', { credentials: 'include' });
            if (sessionResp.ok) {
              const session = await sessionResp.json();
              accessToken = session.accessToken || null;
            }
          } catch (e) {
            // session fetch 失败，尝试无 token 模式
          }

          if (!accessToken) return { error: 'no-access-token' };

          // 3. 用 token fetch conversation API
          const convResp = await fetch('/backend-api/conversation/' + conversationId, {
            method: 'GET',
            credentials: 'include',
            headers: { 'Authorization': 'Bearer ' + accessToken },
          });
          if (!convResp.ok) return { error: 'conversation-fetch-failed', status: convResp.status };
          const convText = await convResp.text();

          // 4. 同时尝试获取 textdocs（Canvas 内容）
          let textdocsText = null;
          try {
            const tdResp = await fetch('/backend-api/conversation/' + conversationId + '/textdocs', {
              method: 'GET',
              credentials: 'include',
              headers: { 'Authorization': 'Bearer ' + accessToken },
            });
            if (tdResp.ok) textdocsText = await tdResp.text();
          } catch (e) {
            // textdocs 不存在是正常的
          }

          return {
            conversationId,
            convText,
            convStatus: convResp.status,
            textdocsText,
            accessToken,
          };
        } catch (e) {
          return { error: String(e) };
        }
      })()
    `);

    if (!result || result.error) {
      console.warn('[BrowserCapability] ChatGPT probe failed:', result?.error);
      return;
    }

    // 同步写入 conversation 数据 —— 确保后续 extractTurn 立即可读
    if (result.convText) {
      try {
        const parsed = JSON.parse(result.convText);
        const capturedAt = new Date().toISOString();
        browserCapabilityTraceWriter.writeExtractedJsonSync(pageId, 'conversation.json', {
          kind: 'chatgpt-conversation',
          pageId,
          url: `https://chatgpt.com/backend-api/conversation/${result.conversationId}`,
          capturedAt,
          status: result.convStatus,
          mimeType: 'application/json',
          data: parsed,
        });
      } catch (err) {
        console.warn('[BrowserCapability] ChatGPT conversation JSON parse failed:', err);
      }
    }

    // 同步写入 textdocs 数据
    if (result.textdocsText) {
      try {
        const parsed = JSON.parse(result.textdocsText);
        browserCapabilityTraceWriter.writeExtractedJsonSync(pageId, 'chatgpt-textdocs.json', {
          kind: 'chatgpt-textdocs',
          pageId,
          url: `https://chatgpt.com/backend-api/conversation/${result.conversationId}/textdocs`,
          capturedAt: new Date().toISOString(),
          data: parsed,
        });
      } catch {
        // textdocs parse failure is non-fatal
      }
    }
  } catch (err) {
    console.warn('[BrowserCapability] ChatGPT probe injection failed:', err);
  }
}

function scheduleAnchorRefresh(webContents: WebContents): void {
  clearAnchorRefreshTimers(webContents.id);
  const delays = [250, 1500, 4000];
  const timers: ReturnType<typeof setTimeout>[] = [];
  for (const delay of delays) {
    const timer = setTimeout(() => {
      if (webContents.isDestroyed()) return;
      const pageId = getPageIdForWebContents(webContents);
      if (!pageId) return;
      void captureVisibleSurface(webContents)
        .then((surface) => {
          if (surface.anchors.length > 0) {
            browserCapabilityTraceWriter.updateAnchorSnapshot(pageId, surface.anchors);
          }
          if (surface.interactions.length > 0) {
            browserCapabilityTraceWriter.updateInteractionSnapshot(pageId, surface.interactions);
          }
        })
        .catch((error) => {
          console.warn('[BrowserCapability][Runtime] anchor refresh failed', {
            webContentsId: webContents.id,
            pageId,
            error,
          });
        });
    }, delay);
    timers.push(timer);
  }
  anchorRefreshTimers.set(webContents.id, timers);

  // 对话页��：在页面稳定后主动拉取 conversation 数据
  const probeTimer = setTimeout(() => {
    if (webContents.isDestroyed()) return;
    const pageUrl = safeGetURL(webContents);
    if (pageUrl.includes('chatgpt.com') || pageUrl.includes('chat.openai.com')) {
      void probeChatGPTConversation(webContents);
    } else {
      void probeClaudeConversation(webContents);
    }
  }, 2000);
  timers.push(probeTimer);
}

export const browserCapabilityServices = {
  lifecycleMonitor,
  pageRegistry,
  leaseManager,
  core: coreService,
  state: stateService,
  network: networkService,
  probeClaudeConversation,
  probeChatGPTConversation,
};

export function bindWebContentsPage(webContents: WebContents, input: BindPageInput): string {
  const existing = bindings.get(webContents.id);
  if (existing) return existing.pageId;

  const pageId = `wc:${webContents.id}`;
  bindings.set(webContents.id, { pageId });
  attachSessionNetworkCapture(webContents.session, networkService);
  attachResponseBodyProviders(webContents, networkService);

  pageRegistry.registerPage({
    pageId,
    url: safeGetURL(webContents),
    title: safeGetTitle(webContents),
    partition: input.partition ?? webContents.session?.getStoragePath?.() ?? 'default',
    owner: input.owner,
    visibility: input.visibility ?? 'hidden',
    reusable: true,
    loading: webContents.isLoading(),
    readyState: webContents.isLoading() ? 'loading' : 'unknown',
  });
  pageRegistry.setFrames(pageId, [buildMainFrame(webContents)]);
  browserCapabilityTraceWriter.updateFrameSnapshot(pageId, [buildMainFrame(webContents)]);
  browserCapabilityTraceWriter.updatePageSnapshot(pageId, {
    url: safeGetURL(webContents),
    origin: safeGetOrigin(safeGetURL(webContents)),
    title: safeGetTitle(webContents),
    partition: input.partition ?? webContents.session?.getStoragePath?.() ?? 'default',
  });

  webContents.on('did-start-loading', () => {
    updateSnapshot(webContents, { loading: true }, 'loading');
  });

  webContents.on('did-stop-loading', () => {
    updateSnapshot(webContents, { loading: false }, 'complete');
    scheduleAnchorRefresh(webContents);
  });

  webContents.on('did-navigate', (_event, url) => {
    updateSnapshot(webContents, { loading: false, url }, 'interactive');
    scheduleAnchorRefresh(webContents);
  });

  webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (!isMainFrame) return;
    updateSnapshot(webContents, { url }, 'interactive');
    scheduleAnchorRefresh(webContents);
  });

  webContents.on('page-title-updated', (event, title) => {
    event.preventDefault();
    pageRegistry.updatePage(pageId, { title });
    browserCapabilityTraceWriter.updatePageSnapshot(pageId, { title });
  });

  webContents.on('destroyed', () => {
    clearAnchorRefreshTimers(webContents.id);
    bindings.delete(webContents.id);
    pageRegistry.destroyPage(pageId);
  });

  return pageId;
}

export function getPageIdForWebContents(webContents: WebContents): string | null {
  return bindings.get(webContents.id)?.pageId ?? null;
}

export function getWebContentsForPage(pageId: string): WebContents | null {
  for (const [webContentsId, binding] of bindings.entries()) {
    if (binding.pageId !== pageId) continue;
    const instance = electronWebContents.fromId(webContentsId);
    if (!instance || instance.isDestroyed()) return null;
    return instance;
  }
  return null;
}

export function setWebContentsVisibility(webContents: WebContents, visibility: BrowserVisibility): void {
  const pageId = getPageIdForWebContents(webContents);
  if (!pageId) return;
  pageRegistry.updatePage(pageId, { visibility });
}

export function listBrowserCapabilityStates(): BrowserState[] {
  return pageRegistry.listPageStates();
}
