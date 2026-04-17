import type { PageResourceLease } from '../types';
import { PageRegistry } from './page-registry';

type AcquireLeaseInput = {
  pageId?: string;
  owner: 'user' | 'agent' | 'system';
  purpose: string;
  visibility?: 'foreground' | 'background' | 'hidden';
  partition?: string;
  reusable?: boolean;
  ttlMs?: number;
};

function createLeaseId(): string {
  return `lease_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createPageId(): string {
  return `page_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * In-memory lease registry for page resources.
 * The manager can allocate a virtual pageId early, then let page-registry bind
 * real webContents later.
 */
export class LeaseManager {
  private leases = new Map<string, PageResourceLease>();

  constructor(private readonly pageRegistry: PageRegistry) {}

  acquire(input: AcquireLeaseInput): PageResourceLease {
    this.sweepExpired();
    const pageId = input.pageId || createPageId();
    if (!this.pageRegistry.hasPage(pageId)) {
      this.pageRegistry.registerPage({
        pageId,
        url: '',
        partition: input.partition ?? 'persist:web',
        owner: input.owner,
        visibility: input.visibility ?? 'hidden',
        reusable: input.reusable ?? true,
        readyState: 'unknown',
      });
    }
    const lease: PageResourceLease = {
      leaseId: createLeaseId(),
      pageId,
      owner: input.owner,
      purpose: input.purpose,
      visibility: input.visibility ?? 'hidden',
      partition: input.partition ?? 'persist:web',
      acquiredAt: new Date().toISOString(),
      expiresAt: typeof input.ttlMs === 'number' ? new Date(Date.now() + input.ttlMs).toISOString() : undefined,
      reusable: input.reusable ?? true,
    };
    this.leases.set(lease.leaseId, lease);
    return lease;
  }

  release(leaseId: string): void {
    this.leases.delete(leaseId);
  }

  list(): PageResourceLease[] {
    this.sweepExpired();
    return Array.from(this.leases.values());
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [leaseId, lease] of Array.from(this.leases.entries())) {
      if (lease.expiresAt && Date.parse(lease.expiresAt) <= now) {
        this.leases.delete(leaseId);
      }
    }
  }
}
