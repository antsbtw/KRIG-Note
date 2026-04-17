import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
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

function readCompletedDownloadFileMeta(savePath: string | undefined): Pick<NonNullable<ReturnType<typeof buildDownloadRecord>>, 'byteLength' | 'sha256' | 'extension' | 'mtime' | 'storageRef'> {
  if (!savePath) return {};
  try {
    if (!fs.existsSync(savePath)) {
      return {
        storageRef: savePath,
        extension: path.extname(savePath).replace(/^\./, '') || undefined,
      };
    }
    const fileBuffer = fs.readFileSync(savePath);
    const stat = fs.statSync(savePath);
    return {
      storageRef: savePath,
      byteLength: fileBuffer.byteLength,
      sha256: createHash('sha256').update(fileBuffer).digest('hex'),
      extension: path.extname(savePath).replace(/^\./, '') || undefined,
      mtime: stat.mtime.toISOString(),
    };
  } catch {
    return {
      storageRef: savePath,
      extension: path.extname(savePath).replace(/^\./, '') || undefined,
    };
  }
}

function buildDownloadRecord(input: {
  downloadId: string;
  pageId: string;
  frameId: string | null;
  item: DownloadItem;
  status: 'completed' | 'cancelled' | 'failed';
  startedAt: string;
  finishedAt: string;
}): {
  downloadId: string;
  pageId: string;
  frameId: string | null;
  url: string;
  filename: string;
  mimeType?: string;
  byteLength?: number;
  sha256?: string;
  extension?: string;
  mtime?: string;
  storageRef?: string;
  status: 'completed' | 'cancelled' | 'failed';
  error?: string;
  startedAt: string;
  finishedAt: string;
} {
  const storageRef = input.item.getSavePath() || undefined;
  const fileMeta = input.status === 'completed'
    ? readCompletedDownloadFileMeta(storageRef)
    : {
        storageRef,
        byteLength: input.item.getReceivedBytes() || undefined,
        extension: storageRef ? path.extname(storageRef).replace(/^\./, '') || undefined : undefined,
      };
  return {
    downloadId: input.downloadId,
    pageId: input.pageId,
    frameId: input.frameId,
    url: input.item.getURL(),
    filename: input.item.getFilename(),
    mimeType: input.item.getMimeType(),
    byteLength: fileMeta.byteLength ?? input.item.getReceivedBytes() ?? undefined,
    sha256: fileMeta.sha256,
    extension: fileMeta.extension,
    mtime: fileMeta.mtime,
    storageRef: fileMeta.storageRef,
    status: input.status,
    error: input.status === 'completed' ? undefined : input.status,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
  };
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
            frameId: record.frameId,
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
            frameId: completed.frameId,
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
      const download = buildDownloadRecord({
        downloadId,
        pageId,
        frameId: webContents?.mainFrame?.routingId ? String(webContents.mainFrame.routingId) : null,
        item,
        status,
        startedAt,
        finishedAt: new Date().toISOString(),
      });
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
          frameId: download.frameId,
          downloadId: download.downloadId,
          filename: download.filename,
          status: download.status,
          url: download.url,
          mimeType: download.mimeType,
          byteLength: download.byteLength,
          sha256: download.sha256,
          extension: download.extension,
          mtime: download.mtime,
          storageRef: download.storageRef,
          at: download.finishedAt ?? new Date().toISOString(),
        });
      }
    });
  });
}
