import type { BrowserState, IBrowserNetworkAPI, NetworkEvent, NetworkRecord } from '../types';

type Listener = (event: NetworkEvent) => void | Promise<void>;

type Subscription = {
  pageId: string;
  kinds: Set<NetworkEvent['kind']>;
  frameId?: string;
  urlIncludes?: string;
  listener: Listener;
};

function normalizeResourceType(resourceType: string | undefined): string | undefined {
  if (!resourceType) return undefined;
  const value = resourceType.toLowerCase();
  if (value === 'mainframe' || value === 'subframe') return 'document';
  if (value === 'xhr') return 'fetch';
  return value;
}

function resourceTypesMatch(left: string | undefined, right: string | undefined): boolean {
  const a = normalizeResourceType(left);
  const b = normalizeResourceType(right);
  if (!a || !b) return true;
  return a === b;
}

/**
 * In-memory event bus + request/download snapshot store.
 * This is the minimal execution core behind IBrowserNetworkAPI.
 */
export class NetworkEventBus implements IBrowserNetworkAPI {
  private static readonly MAX_REQUESTS_PER_PAGE = 500;
  private static readonly MAX_RESPONSE_BODIES = 256;
  private static readonly MAX_PROVIDER_REQUESTS = 1024;
  private subscriptions = new Map<string, Subscription>();
  private requests = new Map<string, NetworkRecord[]>();
  private responseBodies = new Map<string, Uint8Array>();
  private responseBodiesByRef = new Map<string, Uint8Array>();
  private bodyRefsByRequestId = new Map<string, string>();
  private downloads = new Map<string, BrowserState['downloads']>();
  private providerRequests = new Map<string, {
    pageId: string;
    providerRequestId: string;
    url: string;
    method: string;
    resourceType?: string;
    startedAt: string;
    canonicalRequestId?: string;
  }>();

  async listRequests(
    pageId: string,
    filter?: { frameId?: string; urlIncludes?: string; resourceType?: string; limit?: number },
  ): Promise<NetworkRecord[]> {
    const records = this.requests.get(pageId) ?? [];
    let out = records.filter((record) => {
      if (filter?.frameId && record.frameId !== filter.frameId) return false;
      if (filter?.urlIncludes && !record.url.includes(filter.urlIncludes)) return false;
      if (filter?.resourceType && record.resourceType !== filter.resourceType) return false;
      return true;
    });
    if (typeof filter?.limit === 'number') out = out.slice(-filter.limit);
    return out;
  }

  async getResponseBody(requestId: string): Promise<Uint8Array | null> {
    return this.responseBodies.get(requestId) ?? null;
  }

  async getResponseBodyByRef(bodyRef: string): Promise<Uint8Array | null> {
    return this.responseBodiesByRef.get(bodyRef) ?? null;
  }

  attachResponseBody(input: {
    pageId: string;
    url: string;
    method: string;
    status?: number;
    resourceType?: string;
    mimeType?: string;
    responseHeaders?: Record<string, string>;
    bodyRef: string;
    body: Uint8Array;
  }): string | null {
    const list = this.requests.get(input.pageId) ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      const record = list[i];
      if (record.url !== input.url) continue;
      if (record.method !== input.method) continue;
      if (typeof input.status === 'number' && record.status !== input.status) continue;
      if (!resourceTypesMatch(record.resourceType, input.resourceType)) continue;

      const next: NetworkRecord = {
        ...record,
        mimeType: input.mimeType ?? record.mimeType,
        responseHeaders: input.responseHeaders ?? record.responseHeaders,
        bodyRef: input.bodyRef,
        bodyBytes: input.body.byteLength,
      };
      list[i] = next;
      this.requests.set(input.pageId, this.limitRequests([...list]));
      this.storeResponseBody(record.requestId, input.bodyRef, input.body);
      return record.requestId;
    }
    return null;
  }

  bindProviderRequest(
    pageId: string,
    providerRequestId: string,
    input: {
      url: string;
      method: string;
      resourceType?: string;
      startedAt: string;
    },
  ): void {
    const key = this.makeProviderKey(pageId, providerRequestId);
    const binding: {
      pageId: string;
      providerRequestId: string;
      url: string;
      method: string;
      resourceType?: string;
      startedAt: string;
      canonicalRequestId?: string;
    } = {
      pageId,
      providerRequestId,
      url: input.url,
      method: input.method,
      resourceType: normalizeResourceType(input.resourceType),
      startedAt: input.startedAt,
    };
    const canonicalRequestId = this.findCanonicalRequestId(pageId, input);
    if (canonicalRequestId) {
      binding.canonicalRequestId = canonicalRequestId;
    }
    this.providerRequests.set(key, binding);
    this.pruneProviderRequests();
  }

  attachResponseBodyFromProvider(
    pageId: string,
    providerRequestId: string,
    input: {
      requestId: string;
      url: string;
      method: string;
      resourceType?: string;
      status?: number;
      mimeType?: string;
      responseHeaders?: Record<string, string>;
      body: Uint8Array;
    },
  ): NetworkRecord | null {
    const key = this.makeProviderKey(pageId, providerRequestId);
    const binding = this.providerRequests.get(key);
    const canonicalRequestId =
      binding?.canonicalRequestId ??
      this.findCanonicalRequestId(pageId, {
        url: input.url,
        method: input.method,
        resourceType: input.resourceType,
        startedAt: new Date().toISOString(),
      });
    if (!canonicalRequestId) return null;
    if (binding) {
      binding.canonicalRequestId = canonicalRequestId;
      this.providerRequests.set(key, binding);
    }
    return (this.requests.get(pageId) ?? []).find((record) => record.requestId === canonicalRequestId) ?? null;
  }

  attachResponseBodyToRequest(
    pageId: string,
    requestId: string,
    input: {
      providerRequestId?: string;
      bodyRef: string;
      body: Uint8Array;
      mimeType?: string;
      responseHeaders?: Record<string, string>;
    },
  ): void {
    const records = this.requests.get(pageId) ?? [];
    const next = records.map((record) => {
      if (record.requestId !== requestId) return record;
      return {
        ...record,
        providerRequestId: input.providerRequestId ?? record.providerRequestId,
        bodyRef: input.bodyRef,
        bodyBytes: input.body.byteLength,
        mimeType: input.mimeType ?? record.mimeType,
        responseHeaders: input.responseHeaders ?? record.responseHeaders,
      };
    });
    this.requests.set(pageId, this.limitRequests(next));
    this.storeResponseBody(requestId, input.bodyRef, input.body);
  }

  storeDetachedResponseBody(requestId: string, bodyRef: string, body: Uint8Array): void {
    this.storeResponseBody(requestId, bodyRef, body);
  }

  async waitForRequest(
    pageId: string,
    matcher: { urlIncludes?: string; method?: string; resourceType?: string; timeoutMs?: number },
  ): Promise<NetworkRecord | null> {
    const found = (this.requests.get(pageId) ?? []).find((record) => {
      if (matcher.urlIncludes && !record.url.includes(matcher.urlIncludes)) return false;
      if (matcher.method && record.method !== matcher.method) return false;
      if (matcher.resourceType && !resourceTypesMatch(record.resourceType, matcher.resourceType)) return false;
      return true;
    });
    if (found) return found;

    return new Promise<NetworkRecord | null>((resolve) => {
      const timeoutMs = matcher.timeoutMs ?? 10_000;
      let settled = false;
      let unsubscribe: (() => void) | null = null;
      const timer = globalThis.setTimeout(() => {
        if (settled) return;
        settled = true;
        if (unsubscribe) unsubscribe();
        resolve(null);
      }, timeoutMs);

      void this.subscribe(
        pageId,
        {
          kinds: ['request-start', 'response-complete'],
          urlIncludes: matcher.urlIncludes,
        },
        async () => {
          const candidate = (this.requests.get(pageId) ?? []).find((record) => {
            if (matcher.urlIncludes && !record.url.includes(matcher.urlIncludes)) return false;
            if (matcher.method && record.method !== matcher.method) return false;
            if (matcher.resourceType && !resourceTypesMatch(record.resourceType, matcher.resourceType)) return false;
            return true;
          });
          if (!candidate || settled) return;
          settled = true;
          globalThis.clearTimeout(timer);
          if (unsubscribe) unsubscribe();
          resolve(candidate);
        },
      ).then((fn) => {
        unsubscribe = fn;
      });
    });
  }

  async captureSSE(_pageId: string, _config: { urlIncludes: string; parser: 'text-delta' | 'json-line' | 'raw' }): Promise<void> {
    // Hooking fetch/XHR/SSE is intentionally deferred to Phase 2 concrete implementation.
  }

  async listDownloads(pageId: string): Promise<BrowserState['downloads']> {
    return this.downloads.get(pageId) ?? [];
  }

  async subscribe(
    pageId: string,
    config: { kinds: Array<NetworkEvent['kind']>; frameId?: string; urlIncludes?: string },
    listener: Listener,
  ): Promise<() => void> {
    const id = `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.subscriptions.set(id, {
      pageId,
      kinds: new Set(config.kinds),
      frameId: config.frameId,
      urlIncludes: config.urlIncludes,
      listener,
    });
    return () => {
      this.subscriptions.delete(id);
    };
  }

  recordRequest(record: NetworkRecord): void {
    const list = this.requests.get(record.pageId) ?? [];
    const canonicalProviderRequestId = this.findProviderRequestId(record.pageId, record);
    const nextRecord: NetworkRecord = canonicalProviderRequestId
      ? { ...record, providerRequestId: canonicalProviderRequestId }
      : record;
    const next = [...list.filter((item) => item.requestId !== record.requestId), nextRecord];
    this.requests.set(record.pageId, this.limitRequests(next));
    this.emit({
      kind: 'request-start',
      pageId: nextRecord.pageId,
      frameId: nextRecord.frameId ?? null,
      requestId: nextRecord.requestId,
      url: nextRecord.url,
      method: nextRecord.method,
      at: nextRecord.startedAt,
    });
  }

  recordResponseChunk(input: {
    pageId: string;
    frameId?: string | null;
    requestId: string;
    mimeType?: string;
    chunkText?: string;
    chunkBytesRef?: string;
    at?: string;
  }): void {
    this.emit({
      kind: 'response-chunk',
      pageId: input.pageId,
      frameId: input.frameId ?? null,
      requestId: input.requestId,
      mimeType: input.mimeType,
      chunkText: input.chunkText,
      chunkBytesRef: input.chunkBytesRef,
      at: input.at ?? new Date().toISOString(),
    });
  }

  recordResponseComplete(record: NetworkRecord, body?: Uint8Array): void {
    const list = this.requests.get(record.pageId) ?? [];
    const next = [...list.filter((item) => item.requestId !== record.requestId), record];
    this.requests.set(record.pageId, this.limitRequests(next));
    if (body && record.bodyRef) this.storeResponseBody(record.requestId, record.bodyRef, body);
    this.emit({
      kind: 'response-complete',
      pageId: record.pageId,
      frameId: record.frameId ?? null,
      requestId: record.requestId,
      status: record.status,
      bodyRef: record.bodyRef,
      at: record.finishedAt ?? new Date().toISOString(),
    });
  }

  recordDownloadComplete(input: BrowserState['downloads'][number]): void {
    const list = this.downloads.get(input.pageId) ?? [];
    const next = [...list.filter((item) => item.downloadId !== input.downloadId), input];
    this.downloads.set(input.pageId, next);
    this.emit({
      kind: 'download-complete',
      pageId: input.pageId,
      frameId: input.frameId ?? null,
      downloadId: input.downloadId,
      filename: input.filename,
      storageRef: input.storageRef,
      at: input.finishedAt ?? new Date().toISOString(),
    });
  }

  private emit(event: NetworkEvent): void {
    for (const subscription of Array.from(this.subscriptions.values())) {
      if (subscription.pageId !== event.pageId) continue;
      if (!subscription.kinds.has(event.kind)) continue;
      if (subscription.frameId && event.frameId !== subscription.frameId) continue;
      if (subscription.urlIncludes) {
        const url =
          event.kind === 'request-start'
            ? event.url
            : event.kind === 'response-chunk' || event.kind === 'response-complete'
              ? this.findRequestUrl(event.pageId, event.requestId)
              : null;
        if (!url || !url.includes(subscription.urlIncludes)) continue;
      }
      void Promise.resolve(subscription.listener(event)).catch(() => {
        console.warn('[BrowserCapability][Network] subscriber failed', {
          pageId: event.pageId,
          kind: event.kind,
        });
      });
    }
  }

  private limitRequests(records: NetworkRecord[]): NetworkRecord[] {
    if (records.length <= NetworkEventBus.MAX_REQUESTS_PER_PAGE) return records;
    return records.slice(-NetworkEventBus.MAX_REQUESTS_PER_PAGE);
  }

  private pruneProviderRequests(): void {
    while (this.providerRequests.size > NetworkEventBus.MAX_PROVIDER_REQUESTS) {
      const firstKey = this.providerRequests.keys().next().value;
      if (!firstKey) break;
      this.providerRequests.delete(firstKey);
    }
  }

  private storeResponseBody(requestId: string, bodyRef: string, body: Uint8Array): void {
    this.responseBodies.set(requestId, body);
    this.responseBodiesByRef.set(bodyRef, body);
    this.bodyRefsByRequestId.set(requestId, bodyRef);
    while (this.responseBodies.size > NetworkEventBus.MAX_RESPONSE_BODIES) {
      const oldestRequestId = this.responseBodies.keys().next().value;
      if (!oldestRequestId) break;
      this.responseBodies.delete(oldestRequestId);
      const oldestBodyRef = this.bodyRefsByRequestId.get(oldestRequestId);
      if (oldestBodyRef) {
        this.responseBodiesByRef.delete(oldestBodyRef);
      }
      this.bodyRefsByRequestId.delete(oldestRequestId);
    }
  }

  private findRequestUrl(pageId: string, requestId: string): string | null {
    return (this.requests.get(pageId) ?? []).find((record) => record.requestId === requestId)?.url ?? null;
  }

  private makeProviderKey(pageId: string, providerRequestId: string): string {
    return `${pageId}:${providerRequestId}`;
  }

  private findCanonicalRequestId(
    pageId: string,
    input: {
      url: string;
      method: string;
      resourceType?: string;
      startedAt: string;
    },
  ): string | null {
    const records = this.requests.get(pageId) ?? [];
    const startedAt = Date.parse(input.startedAt);
    let best: { requestId: string; delta: number } | null = null;
    for (const record of records) {
      if (record.url !== input.url) continue;
      if (record.method !== input.method) continue;
      if (!resourceTypesMatch(record.resourceType, input.resourceType)) continue;
      const delta = Math.abs(Date.parse(record.startedAt) - startedAt);
      if (delta > 10_000) continue;
      if (!best || delta < best.delta) {
        best = { requestId: record.requestId, delta };
      }
    }
    return best?.requestId ?? null;
  }

  private findProviderRequestId(pageId: string, record: NetworkRecord): string | null {
    let best: { providerRequestId: string; delta: number } | null = null;
    for (const binding of this.providerRequests.values()) {
      if (binding.pageId !== pageId) continue;
      if (binding.canonicalRequestId && binding.canonicalRequestId !== record.requestId) continue;
      if (binding.url !== record.url) continue;
      if (binding.method !== record.method) continue;
      if (!resourceTypesMatch(binding.resourceType, record.resourceType)) continue;
      const delta = Math.abs(Date.parse(binding.startedAt) - Date.parse(record.startedAt));
      if (delta > 10_000) continue;
      if (!best || delta < best.delta) {
        best = { providerRequestId: binding.providerRequestId, delta };
      }
    }
    if (!best) return null;
    const key = this.makeProviderKey(pageId, best.providerRequestId);
    const binding = this.providerRequests.get(key);
    if (binding) {
      binding.canonicalRequestId = record.requestId;
      this.providerRequests.set(key, binding);
    }
    return best.providerRequestId;
  }
}
