import type { WebContents } from 'electron';
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
  return {
    frameId: `frame:${webContents.id}:main`,
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
  });

  webContents.on('did-navigate', (_event, url) => {
    updateSnapshot(webContents, { loading: false, url }, 'interactive');
  });

  webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (!isMainFrame) return;
    updateSnapshot(webContents, { url }, 'interactive');
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
