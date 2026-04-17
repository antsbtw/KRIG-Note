import type { WebContents } from 'electron';
import { browserCapabilityTraceWriter } from '../persistence';
import { getPageIdForWebContents } from '../main-service';
import type { NetworkRecord } from '../types';
import { NetworkEventBus } from './network-event-bus';

export type ResponseBodyProviderCapture = {
  requestId: string;
  url: string;
  method: string;
  resourceType?: string;
  status?: number;
  mimeType?: string;
  responseHeaders?: Record<string, string>;
  body: Uint8Array;
};

export interface ResponseBodyProvider {
  readonly providerId: string;
  attach(webContents: WebContents, bus: NetworkEventBus): void;
}

type PendingProviderRequest = {
  url: string;
  method: string;
  resourceType?: string;
  status?: number;
  mimeType?: string;
  responseHeaders?: Record<string, string>;
};

const attachedWebContents = new Set<number>();
const NOISY_URL_SUBSTRINGS = [
  'browser-intake-us5-datadoghq.com',
  'google-analytics.com',
  'play.google.com/log',
  '/gen_204?',
  'api-iam.intercom.io/messenger/web/ping',
  'api-iam.intercom.io/messenger/web/metrics',
  'connect.facebook.net',
  'widget.intercom.io',
  'js.intercomcdn.com',
];

function toHeaderMap(headers: Record<string, unknown> | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      out[key] = value.map((item) => String(item)).join(', ');
      continue;
    }
    if (value !== undefined && value !== null) {
      out[key] = String(value);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function shouldCaptureResponseBody(input: PendingProviderRequest): boolean {
  if (!input.url.startsWith('http://') && !input.url.startsWith('https://')) return false;
  if (NOISY_URL_SUBSTRINGS.some((part) => input.url.includes(part))) return false;
  const type = String(input.resourceType || '').toLowerCase();
  return type === 'xhr' || type === 'fetch' || type === 'document';
}

function decodeDebuggerBody(result: { body?: string; base64Encoded?: boolean }): Uint8Array | null {
  if (typeof result.body !== 'string') return null;
  if (result.base64Encoded) {
    return new Uint8Array(Buffer.from(result.body, 'base64'));
  }
  return new TextEncoder().encode(result.body);
}

export class CdpResponseBodyProvider implements ResponseBodyProvider {
  readonly providerId = 'cdp';

  attach(webContents: WebContents, bus: NetworkEventBus): void {
    if (attachedWebContents.has(webContents.id)) return;
    attachedWebContents.add(webContents.id);

    const pending = new Map<string, PendingProviderRequest>();
    const dbg = webContents.debugger;

    try {
      if (!dbg.isAttached()) {
        dbg.attach('1.3');
      }
    } catch (error) {
      attachedWebContents.delete(webContents.id);
      console.warn('[BrowserCapability][Network] response body provider attach failed', {
        providerId: this.providerId,
        webContentsId: webContents.id,
        error,
      });
      return;
    }

    dbg.sendCommand('Network.enable').catch((error) => {
      console.warn('[BrowserCapability][Network] provider Network.enable failed', {
        providerId: this.providerId,
        webContentsId: webContents.id,
        error,
      });
    });

    const onMessage = (_event: Electron.Event, method: string, params: any) => {
      const pageId = getPageIdForWebContents(webContents);
      if (!pageId) return;

      if (method === 'Network.requestWillBeSent') {
        const url = typeof params?.request?.url === 'string' ? params.request.url : '';
        if (!url) return;
        const providerRequestId = String(params.requestId);
        pending.set(providerRequestId, {
          url,
          method: String(params?.request?.method || 'GET').toUpperCase(),
          resourceType: typeof params?.type === 'string' ? params.type.toLowerCase() : undefined,
        });
        bus.bindProviderRequest(pageId, providerRequestId, {
          url,
          method: String(params?.request?.method || 'GET').toUpperCase(),
          resourceType: typeof params?.type === 'string' ? params.type.toLowerCase() : undefined,
          startedAt: new Date().toISOString(),
        });
        return;
      }

      if (method === 'Network.responseReceived') {
        const providerRequestId = String(params?.requestId || '');
        const existing = pending.get(providerRequestId);
        if (!existing) return;
        pending.set(providerRequestId, {
          ...existing,
          status: typeof params?.response?.status === 'number' ? params.response.status : undefined,
          mimeType: typeof params?.response?.mimeType === 'string' ? params.response.mimeType : undefined,
          responseHeaders: toHeaderMap(params?.response?.headers),
        });
        return;
      }

      if (method === 'Network.loadingFailed') {
        pending.delete(String(params?.requestId || ''));
        return;
      }

      if (method !== 'Network.loadingFinished') return;

      const providerRequestId = String(params?.requestId || '');
      const request = pending.get(providerRequestId);
      if (!request) return;
      pending.delete(providerRequestId);
      if (!shouldCaptureResponseBody(request)) return;

      dbg.sendCommand('Network.getResponseBody', { requestId: providerRequestId }).then((result: any) => {
        const body = decodeDebuggerBody(result ?? {});
        if (!body || body.byteLength === 0) return;

        const canonicalRequest = bus.attachResponseBodyFromProvider(pageId, providerRequestId, {
          requestId: providerRequestId,
          url: request.url,
          method: request.method,
          resourceType: request.resourceType,
          status: request.status,
          mimeType: request.mimeType,
          responseHeaders: request.responseHeaders,
          body,
        });

        const traceRequestId = canonicalRequest?.requestId ?? providerRequestId;
        const bodyRef = browserCapabilityTraceWriter.writeResponseBody({
          pageId,
          requestId: traceRequestId,
          providerRequestId,
          url: request.url,
          method: request.method,
          resourceType: request.resourceType,
          status: request.status,
          mimeType: request.mimeType,
          responseHeaders: request.responseHeaders,
          body,
        });

        if (canonicalRequest) {
          bus.attachResponseBodyToRequest(pageId, canonicalRequest.requestId, {
            providerRequestId,
            bodyRef,
            body,
            mimeType: request.mimeType,
            responseHeaders: request.responseHeaders,
          });
        } else {
          bus.storeDetachedResponseBody(traceRequestId, bodyRef, body);
        }
      }).catch(() => {
        // Response body is not available for every request.
      });
    };

    const onDetach = () => {
      pending.clear();
    };

    dbg.on('message', onMessage);
    dbg.on('detach', onDetach);

    webContents.once('destroyed', () => {
      attachedWebContents.delete(webContents.id);
      pending.clear();
      dbg.removeListener('message', onMessage);
      dbg.removeListener('detach', onDetach);
    });
  }
}

const defaultProviders: ResponseBodyProvider[] = [new CdpResponseBodyProvider()];

export function attachResponseBodyProviders(
  webContents: WebContents,
  bus: NetworkEventBus,
  providers: ResponseBodyProvider[] = defaultProviders,
): void {
  for (const provider of providers) {
    provider.attach(webContents, bus);
  }
}

export type CanonicalBodyAttachment = Pick<NetworkRecord, 'requestId'> | null;
