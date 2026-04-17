import type { BrowserOwner, BrowserState, BrowserVisibility, FrameState, ReadyState } from '../types';
import { LifecycleMonitor } from './lifecycle-monitor';

type RegisteredPageInput = {
  pageId: string;
  url: string;
  title?: string;
  partition: string;
  owner?: BrowserOwner;
  visibility?: BrowserVisibility;
  reusable?: boolean;
  loading?: boolean;
  readyState?: ReadyState;
};

type PageRecord = {
  state: BrowserState;
};

function isSameFrame(a: FrameState, b: FrameState): boolean {
  return (
    a.frameId === b.frameId &&
    a.parentFrameId === b.parentFrameId &&
    a.url === b.url &&
    a.origin === b.origin &&
    a.visible === b.visible &&
    a.kind === b.kind &&
    JSON.stringify(a.bounds ?? null) === JSON.stringify(b.bounds ?? null)
  );
}

function areSameFrames(a: FrameState[], b: FrameState[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((frame, index) => isSameFrame(frame, b[index]));
}

/**
 * In-memory page/frame registry.
 * This is the first stable place to map pageId -> browser state.
 */
export class PageRegistry {
  private pages = new Map<string, PageRecord>();

  constructor(private readonly lifecycle: LifecycleMonitor) {}

  registerPage(input: RegisteredPageInput): BrowserState {
    const existing = this.pages.get(input.pageId)?.state;
    const state: BrowserState = {
      pageId: input.pageId,
      url: input.url,
      title: input.title ?? existing?.title ?? '',
      partition: input.partition,
      loading: input.loading ?? existing?.loading ?? false,
      readyState: input.readyState ?? existing?.readyState ?? 'unknown',
      visibility: input.visibility ?? existing?.visibility ?? 'foreground',
      owner: input.owner ?? existing?.owner ?? 'system',
      reusable: input.reusable ?? existing?.reusable ?? false,
      frames: existing?.frames ?? [],
      downloads: existing?.downloads ?? [],
      selection: existing?.selection ?? null,
      capturedAt: new Date().toISOString(),
    };
    this.pages.set(input.pageId, { state });
    if (!existing) {
      this.lifecycle.emit({
        kind: 'page-created',
        pageId: input.pageId,
        url: input.url,
        partition: input.partition,
        at: new Date().toISOString(),
      });
    }
    return state;
  }

  updatePage(
    pageId: string,
    patch: Partial<Omit<BrowserState, 'pageId' | 'frames' | 'downloads' | 'capturedAt'>>,
  ): BrowserState | null {
    const record = this.pages.get(pageId);
    if (!record) return null;
    const prev = record.state;
    record.state = {
      ...prev,
      ...patch,
      capturedAt: new Date().toISOString(),
    };
    if (typeof patch.url === 'string' && patch.url && patch.url !== prev.url) {
      this.lifecycle.emit({
        kind: 'page-navigated',
        pageId,
        url: patch.url,
        at: new Date().toISOString(),
      });
    }
    return record.state;
  }

  destroyPage(pageId: string): boolean {
    const deleted = this.pages.delete(pageId);
    if (deleted) {
      this.lifecycle.emit({
        kind: 'page-destroyed',
        pageId,
        at: new Date().toISOString(),
      });
    }
    return deleted;
  }

  setFrames(pageId: string, frames: FrameState[]): FrameState[] {
    const record = this.pages.get(pageId);
    if (!record) return [];
    const prevFrames = record.state.frames ?? [];
    record.state = {
      ...record.state,
      frames,
      capturedAt: new Date().toISOString(),
    };
    if (areSameFrames(prevFrames, frames)) {
      return frames;
    }
    for (const frame of frames) {
      const prev = prevFrames.find((item) => item.frameId === frame.frameId);
      if (!prev || !isSameFrame(prev, frame)) {
        this.lifecycle.emit({
          kind: 'frame-updated',
          pageId,
          frame,
          at: new Date().toISOString(),
        });
      }
    }
    return frames;
  }

  setDownloads(pageId: string, downloads: BrowserState['downloads']): BrowserState['downloads'] {
    const record = this.pages.get(pageId);
    if (!record) return [];
    record.state = {
      ...record.state,
      downloads,
      capturedAt: new Date().toISOString(),
    };
    return downloads;
  }

  getPageState(pageId: string): BrowserState | null {
    return this.pages.get(pageId)?.state ?? null;
  }

  listFrames(pageId: string): FrameState[] {
    return this.pages.get(pageId)?.state.frames ?? [];
  }

  getActiveFrame(pageId: string): FrameState | null {
    const frames = this.listFrames(pageId);
    return frames.find((frame) => frame.kind === 'main') ?? frames[0] ?? null;
  }

  hasPage(pageId: string): boolean {
    return this.pages.has(pageId);
  }

  listPageStates(): BrowserState[] {
    return Array.from(this.pages.values()).map((record) => record.state);
  }
}
