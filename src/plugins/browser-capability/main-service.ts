import type { WebContents } from 'electron';
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
  pageRegistry.updatePage(pageId, {
    title: safeGetTitle(webContents),
    url: safeGetURL(webContents),
    ...patch,
    ...(readyState ? { readyState } : {}),
  });
  const frames = [buildMainFrame(webContents)];
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
          const visible = rect.width > 0 && rect.height > 0;
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

function scheduleAnchorRefresh(webContents: WebContents): void {
  const delays = [250, 1500, 4000];
  for (const delay of delays) {
    setTimeout(() => {
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
        .catch(() => {});
    }, delay);
  }
}

export const browserCapabilityServices = {
  lifecycleMonitor,
  pageRegistry,
  leaseManager,
  core: coreService,
  state: stateService,
  network: networkService,
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
    bindings.delete(webContents.id);
    pageRegistry.destroyPage(pageId);
  });

  return pageId;
}

export function getPageIdForWebContents(webContents: WebContents): string | null {
  return bindings.get(webContents.id)?.pageId ?? null;
}

export function setWebContentsVisibility(webContents: WebContents, visibility: BrowserVisibility): void {
  const pageId = getPageIdForWebContents(webContents);
  if (!pageId) return;
  pageRegistry.updatePage(pageId, { visibility });
}

export function listBrowserCapabilityStates(): BrowserState[] {
  return pageRegistry.listPageStates();
}
