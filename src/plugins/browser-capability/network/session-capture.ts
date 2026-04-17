import { app, webContents } from 'electron';
import type { Session, OnBeforeRequestListenerDetails, OnCompletedListenerDetails, OnErrorOccurredListenerDetails, DownloadItem, WebContents } from 'electron';
import type { NetworkRecord } from '../types';
import { getPageIdForWebContents } from '../main-service';
import { browserCapabilityTraceWriter } from '../persistence';
import { NetworkEventBus } from './network-event-bus';

const attachedSessions = new WeakSet<Session>();
const requestCache = new Map<string, NetworkRecord>();

const NOISY_RESOURCE_TYPES = new Set(['font', 'image', 'ping']);
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
  's-cdn.anthropic.com/images/',
];

function makeRequestCacheKey(details: { id: number; webContentsId?: number }): string {
  return `${details.webContentsId ?? 'unknown'}:${details.id}`;
}

function resolvePageId(webContentsId?: number): string | null {
  if (typeof webContentsId !== 'number') return null;
  const wc = webContents.fromId(webContentsId);
  if (!wc || wc.isDestroyed()) return null;
  return getPageIdForWebContents(wc);
}

function resolvePageIdFromWebContents(webContents: WebContents | null | undefined): string | null {
  if (!webContents || webContents.isDestroyed()) return null;
  return getPageIdForWebContents(webContents);
}

function resourceTypeOf(details: { resourceType?: string }): string | undefined {
  return details.resourceType || undefined;
}

function shouldTraceNetwork(record: Pick<NetworkRecord, 'url' | 'resourceType'>): boolean {
  if (record.resourceType && NOISY_RESOURCE_TYPES.has(record.resourceType)) return false;
  if (NOISY_URL_SUBSTRINGS.some((part) => record.url.includes(part))) return false;
  return true;
}

function toNetworkRecord(
  pageId: string,
  details: OnBeforeRequestListenerDetails,
): NetworkRecord {
  return {
    requestId: String(details.id),
    pageId,
    frameId: details.frame?.routingId ? String(details.frame.routingId) : null,
    url: details.url,
    method: (details.method || 'GET').toUpperCase(),
    resourceType: resourceTypeOf(details),
    startedAt: new Date().toISOString(),
  };
}

function mergeCompleted(
  prev: NetworkRecord,
  details: OnCompletedListenerDetails,
): NetworkRecord {
  const responseHeaders: Record<string, string> = {};
  for (const [key, values] of Object.entries(details.responseHeaders ?? {})) {
    responseHeaders[key] = Array.isArray(values) ? values.join(', ') : String(values);
  }
  return {
    ...prev,
    status: details.statusCode,
    responseHeaders,
    finishedAt: new Date().toISOString(),
  };
}

function mergeErrored(
  prev: NetworkRecord,
  details: OnErrorOccurredListenerDetails,
): NetworkRecord {
  return {
    ...prev,
    finishedAt: new Date().toISOString(),
    responseHeaders: {
      ...(prev.responseHeaders ?? {}),
      'x-krig-error': details.error,
    },
  };
}

export function attachSessionNetworkCapture(session: Session, bus: NetworkEventBus): void {
  if (attachedSessions.has(session)) return;
  attachedSessions.add(session);

  session.webRequest.onBeforeRequest((details, callback) => {
    const pageId = resolvePageId(details.webContentsId);
    if (pageId) {
      const record = toNetworkRecord(pageId, details);
      requestCache.set(makeRequestCacheKey(details), record);
      bus.recordRequest(record);
      if (!app.isPackaged) {
        console.log('[BrowserCapability][Network] request-start', {
          pageId,
          requestId: record.requestId,
          method: record.method,
          resourceType: record.resourceType,
          url: record.url,
        });
        if (shouldTraceNetwork(record)) {
          browserCapabilityTraceWriter.writeNetwork({
            kind: 'request-start',
            pageId,
            requestId: record.requestId,
            method: record.method,
            resourceType: record.resourceType,
            url: record.url,
            at: record.startedAt,
          });
        }
      }
    }
    callback({});
  });

  session.webRequest.onCompleted((details) => {
    const key = makeRequestCacheKey(details);
    const prev = requestCache.get(key);
    const pageId = prev?.pageId ?? resolvePageId(details.webContentsId);
    if (prev && pageId) {
      const completed = mergeCompleted(prev, details);
      bus.recordResponseComplete(completed);
      if (!app.isPackaged) {
        console.log('[BrowserCapability][Network] response-complete', {
          pageId,
          requestId: completed.requestId,
          status: completed.status,
          resourceType: completed.resourceType,
          url: completed.url,
        });
        if (shouldTraceNetwork(completed)) {
          browserCapabilityTraceWriter.writeNetwork({
            kind: 'response-complete',
            pageId,
            requestId: completed.requestId,
            status: completed.status,
            resourceType: completed.resourceType,
            url: completed.url,
            at: completed.finishedAt ?? new Date().toISOString(),
          });
        }
      }
      requestCache.delete(key);
    }
  });

  session.webRequest.onErrorOccurred((details) => {
    const key = makeRequestCacheKey(details);
    const prev = requestCache.get(key);
    const pageId = prev?.pageId ?? resolvePageId(details.webContentsId);
    if (prev && pageId) {
      bus.recordResponseComplete(mergeErrored(prev, details));
      requestCache.delete(key);
    }
  });

  session.on('will-download', (_event, item: DownloadItem, webContents?: WebContents) => {
    const pageId = resolvePageIdFromWebContents(webContents);
    if (!pageId) return;

    const startedAt = new Date().toISOString();
    const downloadId = `dl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    item.once('done', (_e, state) => {
      const status: 'completed' | 'cancelled' | 'failed' =
        state === 'completed'
          ? 'completed'
          : state === 'cancelled'
            ? 'cancelled'
            : 'failed';
      const download = {
        downloadId,
        pageId,
        frameId: webContents?.mainFrame?.routingId ? String(webContents.mainFrame.routingId) : null,
        url: item.getURL(),
        filename: item.getFilename(),
        mimeType: item.getMimeType(),
        byteLength: item.getReceivedBytes(),
        storageRef: item.getSavePath() || undefined,
        status,
        error: state === 'completed' ? undefined : state,
        startedAt,
        finishedAt: new Date().toISOString(),
      };
      bus.recordDownloadComplete(download);
      if (download.status === 'completed') {
        browserCapabilityTraceWriter.recordDownloadedArtifact(download);
      }
      if (!app.isPackaged) {
        console.log('[BrowserCapability][Network] download-complete', {
          pageId,
          downloadId: download.downloadId,
          filename: download.filename,
          status: download.status,
          url: download.url,
        });
        browserCapabilityTraceWriter.writeNetwork({
          kind: 'download-complete',
          pageId,
          downloadId: download.downloadId,
          filename: download.filename,
          status: download.status,
          url: download.url,
          at: download.finishedAt ?? new Date().toISOString(),
        });
      }
    });
  });
}
