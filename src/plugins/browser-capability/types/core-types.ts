import type { BrowserOwner, BrowserVisibility, FrameState } from './browser-state';

export type PageResourceLease = {
  leaseId: string;
  pageId: string;
  owner: BrowserOwner;
  purpose: string;
  visibility: BrowserVisibility;
  partition: string;
  acquiredAt: string;
  expiresAt?: string;
  reusable: boolean;
};

export type PageLifecycleEvent =
  | {
      kind: 'page-created';
      pageId: string;
      url?: string;
      partition: string;
      at: string;
    }
  | {
      kind: 'page-destroyed';
      pageId: string;
      at: string;
    }
  | {
      kind: 'page-navigated';
      pageId: string;
      url: string;
      inPlace?: boolean;
      at: string;
    }
  | {
      kind: 'frame-updated';
      pageId: string;
      frame: FrameState;
      at: string;
    };

