import type { BrowserState, FrameState, IBrowserStateAPI, PageResourceLease } from '../types';
import { LeaseManager } from './lease-manager';
import { PageRegistry } from './page-registry';

export class BrowserStateService implements IBrowserStateAPI {
  constructor(
    private readonly pageRegistry: PageRegistry,
    private readonly leaseManager: LeaseManager,
  ) {}

  async getPageState(pageId: string): Promise<BrowserState> {
    const state = this.pageRegistry.getPageState(pageId);
    if (!state) throw new Error(`Unknown pageId: ${pageId}`);
    return state;
  }

  async listFrames(pageId: string): Promise<FrameState[]> {
    return this.pageRegistry.listFrames(pageId);
  }

  async getActiveFrame(pageId: string): Promise<FrameState | null> {
    return this.pageRegistry.getActiveFrame(pageId);
  }

  async acquirePageLease(input: Parameters<IBrowserStateAPI['acquirePageLease']>[0]): Promise<PageResourceLease> {
    return this.leaseManager.acquire(input);
  }

  async releasePageLease(leaseId: string): Promise<void> {
    this.leaseManager.release(leaseId);
  }

  async listLeases(): Promise<PageResourceLease[]> {
    return this.leaseManager.list();
  }
}

