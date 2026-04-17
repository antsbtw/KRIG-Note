import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import type { ArtifactRecord, DomAnchor, DownloadState, FrameState, PageLifecycleEvent } from '../types';

type NetworkTraceEntry =
  | {
      kind: 'request-start';
      pageId: string;
      requestId: string;
      method: string;
      resourceType?: string;
      url: string;
      at: string;
    }
  | {
      kind: 'response-complete';
      pageId: string;
      requestId: string;
      status?: number;
      resourceType?: string;
      url: string;
      at: string;
    }
  | {
      kind: 'response-body-captured';
      pageId: string;
      requestId: string;
      method: string;
      status?: number;
      resourceType?: string;
      mimeType?: string;
      url: string;
      bodyRef: string;
      bodyBytes: number;
      at: string;
    }
  | {
      kind: 'download-complete';
      pageId: string;
      downloadId: string;
      filename: string;
      status: 'completed' | 'cancelled' | 'failed';
      url: string;
      at: string;
    };

type TraceEntry =
  | {
      stream: 'lifecycle';
      at: string;
      event: PageLifecycleEvent;
    }
  | {
      stream: 'network';
      at: string;
      event: NetworkTraceEntry;
    };

type PageSummary = {
  pageId: string;
  firstSeenAt: string;
  updatedAt: string;
  currentUrl?: string;
  currentOrigin?: string;
  title?: string;
  partition?: string;
  lifecycleCounts: Record<string, number>;
  networkCounts: Record<string, number>;
  resourceTypeCounts: Record<string, number>;
  domainCounts: Record<string, number>;
  downloads: Array<{
    downloadId: string;
    filename: string;
    status: 'completed' | 'cancelled' | 'failed';
    url: string;
    at: string;
  }>;
  keyEvents: NetworkTraceEntry[];
};

type RunSummary = {
  runId: string;
  createdAt: string;
  updatedAt: string;
  pageIds: string[];
  lifecycleCounts: Record<string, number>;
  networkCounts: Record<string, number>;
  resourceTypeCounts: Record<string, number>;
  domainCounts: Record<string, number>;
  downloads: Array<{
    pageId: string;
    downloadId: string;
    filename: string;
    status: 'completed' | 'cancelled' | 'failed';
    url: string;
    at: string;
  }>;
  keyEvents: NetworkTraceEntry[];
};

type PageMeta = {
  pageId: string;
  pageDir: string;
  pageFile: string;
  lifecycleFile: string;
  networkFile: string;
  summaryFile: string;
  extractedDir: string;
  responseDir: string;
};

type GenericExtractedState = {
  artifacts: ArtifactRecord[];
  artifactCandidates: ArtifactRecord[];
  anchors: DomAnchor[];
  frames: FrameState[];
};

type TraceSessionMeta = {
  runId: string;
  createdAt: string;
  traceRootDir: string;
  runDir: string;
  pagesDir: string;
  runSummaryFile: string;
  runMetaFile: string;
};

type PageSnapshotPatch = {
  url?: string;
  origin?: string;
  title?: string;
  partition?: string;
};

type ResponseBodyCapture = {
  pageId: string;
  requestId: string;
  providerRequestId?: string;
  url: string;
  method: string;
  resourceType?: string;
  status?: number;
  mimeType?: string;
  responseHeaders?: Record<string, string>;
  body: Uint8Array;
};

export class BrowserCapabilityTraceWriter {
  private initialized = false;
  private traceRootDir = '';
  private runDir = '';
  private pagesDir = '';
  private runSummaryFile = '';
  private runMetaFile = '';
  private runId = '';
  private createdAt = '';
  private queue: Promise<void> = Promise.resolve();
  private runSummary: RunSummary | null = null;
  private pages = new Map<string, PageMeta>();
  private pageSummaries = new Map<string, PageSummary>();
  private extractedState = new Map<string, GenericExtractedState>();

  init(baseDir?: string): void {
    if (this.initialized) return;

    const traceRootDir = baseDir ?? path.resolve(app.getAppPath(), 'debug', 'browser-capability-traces');
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = new Date().toISOString();
    const runDir = path.join(traceRootDir, runId);
    const pagesDir = path.join(runDir, 'pages');

    fs.mkdirSync(pagesDir, { recursive: true });

    this.traceRootDir = traceRootDir;
    this.runDir = runDir;
    this.pagesDir = pagesDir;
    this.runSummaryFile = path.join(runDir, 'run-summary.json');
    this.runMetaFile = path.join(runDir, 'run.json');
    this.runId = runId;
    this.createdAt = createdAt;
    this.runSummary = {
      runId,
      createdAt,
      updatedAt: createdAt,
      pageIds: [],
      lifecycleCounts: {},
      networkCounts: {},
      resourceTypeCounts: {},
      domainCounts: {},
      downloads: [],
      keyEvents: [],
    };

    const meta: TraceSessionMeta = {
      runId,
      createdAt,
      traceRootDir,
      runDir,
      pagesDir,
      runSummaryFile: this.runSummaryFile,
      runMetaFile: this.runMetaFile,
    };

    fs.writeFileSync(this.runMetaFile, JSON.stringify(meta, null, 2));
    fs.writeFileSync(this.runSummaryFile, JSON.stringify(this.runSummary, null, 2));
    fs.writeFileSync(path.join(traceRootDir, 'latest-run.json'), JSON.stringify(meta, null, 2));

    this.initialized = true;
  }

  getCurrentMeta(): TraceSessionMeta | null {
    if (!this.initialized) return null;
    return {
      runId: this.runId,
      createdAt: this.createdAt,
      traceRootDir: this.traceRootDir,
      runDir: this.runDir,
      pagesDir: this.pagesDir,
      runSummaryFile: this.runSummaryFile,
      runMetaFile: this.runMetaFile,
    };
  }

  writeLifecycle(event: PageLifecycleEvent): void {
    if (!this.initialized) this.init();
    const pageMeta = this.ensurePage(event.pageId);
    this.updateLifecycleSummary(event);

    if (event.kind === 'page-created') {
      this.updatePageSnapshot(event.pageId, {
        url: event.url,
        partition: event.partition,
      });
    } else if (event.kind === 'page-navigated') {
      this.updatePageSnapshot(event.pageId, {
        url: event.url,
        origin: this.safeGetOrigin(event.url),
      });
    } else if (event.kind === 'frame-updated' && event.frame.kind === 'main') {
      this.updatePageSnapshot(event.pageId, {
        url: event.frame.url,
        origin: event.frame.origin,
      });
    }

    this.append(pageMeta.lifecycleFile, {
      stream: 'lifecycle',
      at: new Date().toISOString(),
      event,
    });
  }

  writeNetwork(event: NetworkTraceEntry): void {
    if (!this.initialized) this.init();
    const pageMeta = this.ensurePage(event.pageId);
    this.updateNetworkSummary(event);
    this.append(pageMeta.networkFile, {
      stream: 'network',
      at: new Date().toISOString(),
      event,
    });
  }

  updatePageSnapshot(pageId: string, patch: PageSnapshotPatch): void {
    if (!this.initialized) this.init();
    const pageMeta = this.ensurePage(pageId);
    const summary = this.pageSummaries.get(pageId);
    if (!summary) return;

    if (patch.url !== undefined) summary.currentUrl = patch.url;
    if (patch.origin !== undefined) summary.currentOrigin = patch.origin;
    if (patch.title !== undefined) summary.title = patch.title;
    if (patch.partition !== undefined) summary.partition = patch.partition;
    summary.updatedAt = new Date().toISOString();

    this.queue = this.queue
      .then(() => this.flushPageArtifacts(pageMeta, summary))
      .catch((error) => {
        console.error('[BrowserCapability][Trace] snapshot flush failed', error);
      });
  }

  updateFrameSnapshot(pageId: string, frames: FrameState[]): void {
    if (!this.initialized) this.init();
    const pageMeta = this.ensurePage(pageId);
    const state = this.ensureExtractedState(pageId);
    state.frames = frames.map((frame) => ({ ...frame }));
    this.queue = this.queue
      .then(() => fs.promises.writeFile(
        path.join(pageMeta.extractedDir, 'frames.json'),
        JSON.stringify({
          pageId,
          updatedAt: new Date().toISOString(),
          frames: state.frames,
        }, null, 2),
        'utf8',
      ))
      .catch((error) => {
        console.error('[BrowserCapability][Trace] frame snapshot flush failed', error);
      });
  }

  recordDownloadedArtifact(download: DownloadState): void {
    if (!this.initialized) this.init();
    if (download.status !== 'completed') return;
    this.writeArtifactsExtraction(download.pageId, [this.toArtifactFromDownload(download)]);
  }

  writeResponseBody(input: ResponseBodyCapture): string {
    if (!this.initialized) this.init();
    const pageMeta = this.ensurePage(input.pageId);
    const bodyRef = path.join('responses', `${this.safeSegment(input.requestId)}.json`);
    const outputFile = path.join(pageMeta.pageDir, bodyRef);
    const capturedAt = new Date().toISOString();
    const serialized = this.serializeResponseBody(input, bodyRef, capturedAt);

    this.queue = this.queue
      .then(async () => {
        await fs.promises.writeFile(outputFile, JSON.stringify(serialized, null, 2), 'utf8');
        this.writeNetworkDerivedExtraction(input.pageId, input, serialized, capturedAt);
        this.writeNetwork({
          kind: 'response-body-captured',
          pageId: input.pageId,
          requestId: input.requestId,
          method: input.method,
          status: input.status,
          resourceType: input.resourceType,
          mimeType: input.mimeType,
          url: input.url,
          bodyRef,
          bodyBytes: input.body.byteLength,
          at: capturedAt,
        });
      })
      .catch((error) => {
        console.error('[BrowserCapability][Trace] response body flush failed', error);
      });

    return bodyRef;
  }

  private ensurePage(pageId: string): PageMeta {
    const existing = this.pages.get(pageId);
    if (existing) return existing;

    const safePageId = pageId.replace(/[^a-zA-Z0-9:_-]/g, '_');
    const pageDir = path.join(this.pagesDir, safePageId);
    const extractedDir = path.join(pageDir, 'extracted');
    const responseDir = path.join(pageDir, 'responses');
    const pageMeta: PageMeta = {
      pageId,
      pageDir,
      pageFile: path.join(pageDir, 'page.json'),
      lifecycleFile: path.join(pageDir, 'lifecycle.jsonl'),
      networkFile: path.join(pageDir, 'network.jsonl'),
      summaryFile: path.join(pageDir, 'summary.json'),
      extractedDir,
      responseDir,
    };

    fs.mkdirSync(extractedDir, { recursive: true });
    fs.mkdirSync(responseDir, { recursive: true });
    this.pages.set(pageId, pageMeta);

    const now = new Date().toISOString();
    const summary: PageSummary = {
      pageId,
      firstSeenAt: now,
      updatedAt: now,
      lifecycleCounts: {},
      networkCounts: {},
      resourceTypeCounts: {},
      domainCounts: {},
      downloads: [],
      keyEvents: [],
    };
    this.pageSummaries.set(pageId, summary);
    this.extractedState.set(pageId, {
      artifacts: [],
      artifactCandidates: [],
      anchors: [],
      frames: [],
    });

    if (this.runSummary && !this.runSummary.pageIds.includes(pageId)) {
      this.runSummary.pageIds.push(pageId);
    }

    fs.writeFileSync(pageMeta.pageFile, JSON.stringify({
      pageId,
      pageDir,
      extractedDir,
      responseDir,
      firstSeenAt: now,
      updatedAt: now,
    }, null, 2));
    fs.writeFileSync(pageMeta.summaryFile, JSON.stringify(summary, null, 2));
    fs.writeFileSync(path.join(extractedDir, 'anchors.json'), JSON.stringify({
      pageId,
      updatedAt: now,
      anchors: [],
    }, null, 2));
    fs.writeFileSync(path.join(extractedDir, 'artifacts.json'), JSON.stringify({
      pageId,
      updatedAt: now,
      artifacts: [],
    }, null, 2));
    fs.writeFileSync(path.join(extractedDir, 'downloads.json'), JSON.stringify({
      pageId,
      updatedAt: now,
      downloads: [],
    }, null, 2));
    fs.writeFileSync(path.join(extractedDir, 'frames.json'), JSON.stringify({
      pageId,
      updatedAt: now,
      frames: [],
    }, null, 2));

    return pageMeta;
  }

  private append(filePath: string, entry: TraceEntry): void {
    const line = `${JSON.stringify(entry)}\n`;
    this.queue = this.queue
      .then(async () => {
        await fs.promises.appendFile(filePath, line, 'utf8');
        await this.flushAllSummaries();
      })
      .catch((error) => {
        console.error('[BrowserCapability][Trace] append failed', error);
      });
  }

  private async flushAllSummaries(): Promise<void> {
    if (this.runSummary) {
      await fs.promises.writeFile(this.runSummaryFile, JSON.stringify(this.runSummary, null, 2), 'utf8');
    }
    for (const [pageId, pageMeta] of this.pages.entries()) {
      const summary = this.pageSummaries.get(pageId);
      if (!summary) continue;
      await this.flushPageArtifacts(pageMeta, summary);
    }
  }

  private async flushPageArtifacts(pageMeta: PageMeta, summary: PageSummary): Promise<void> {
    await fs.promises.writeFile(pageMeta.summaryFile, JSON.stringify(summary, null, 2), 'utf8');
    await fs.promises.writeFile(pageMeta.pageFile, JSON.stringify({
      pageId: summary.pageId,
      pageDir: pageMeta.pageDir,
      extractedDir: pageMeta.extractedDir,
      responseDir: pageMeta.responseDir,
      firstSeenAt: summary.firstSeenAt,
      updatedAt: summary.updatedAt,
      currentUrl: summary.currentUrl,
      currentOrigin: summary.currentOrigin,
      title: summary.title,
      partition: summary.partition,
    }, null, 2), 'utf8');
  }

  private updateLifecycleSummary(event: PageLifecycleEvent): void {
    if (!this.runSummary) return;
    this.runSummary.updatedAt = new Date().toISOString();
    this.increment(this.runSummary.lifecycleCounts, event.kind);

    const pageSummary = this.pageSummaries.get(event.pageId);
    if (!pageSummary) return;
    pageSummary.updatedAt = new Date().toISOString();
    this.increment(pageSummary.lifecycleCounts, event.kind);
  }

  private updateNetworkSummary(event: NetworkTraceEntry): void {
    if (!this.runSummary) return;
    this.runSummary.updatedAt = new Date().toISOString();
    this.increment(this.runSummary.networkCounts, event.kind);

    const pageSummary = this.pageSummaries.get(event.pageId);
    if (!pageSummary) return;
    pageSummary.updatedAt = new Date().toISOString();
    this.increment(pageSummary.networkCounts, event.kind);

    if ('resourceType' in event && event.resourceType) {
      this.increment(this.runSummary.resourceTypeCounts, event.resourceType);
      this.increment(pageSummary.resourceTypeCounts, event.resourceType);
    }

    if ('url' in event && event.url) {
      const domain = this.safeGetDomain(event.url);
      if (domain) {
        this.increment(this.runSummary.domainCounts, domain);
        this.increment(pageSummary.domainCounts, domain);
      }
      if (this.isKeyEvent(event)) {
        this.runSummary.keyEvents.push(event);
        this.runSummary.keyEvents = this.runSummary.keyEvents.slice(-100);
        pageSummary.keyEvents.push(event);
        pageSummary.keyEvents = pageSummary.keyEvents.slice(-50);
      }
    }

    if (event.kind === 'download-complete') {
      const download = {
        pageId: event.pageId,
        downloadId: event.downloadId,
        filename: event.filename,
        status: event.status,
        url: event.url,
        at: event.at,
      };
      this.runSummary.downloads.push(download);
      this.runSummary.downloads = this.runSummary.downloads.slice(-50);
      pageSummary.downloads.push({
        downloadId: event.downloadId,
        filename: event.filename,
        status: event.status,
        url: event.url,
        at: event.at,
      });
      pageSummary.downloads = pageSummary.downloads.slice(-20);
      this.writeDownloadsExtraction(event.pageId, pageSummary);
    }
  }

  private serializeResponseBody(
    input: ResponseBodyCapture,
    bodyRef: string,
    capturedAt: string,
  ): Record<string, unknown> {
    const textBody = this.tryDecodeTextBody(input.body, input.mimeType, input.url);
    return {
      pageId: input.pageId,
      requestId: input.requestId,
      providerRequestId: input.providerRequestId,
      url: input.url,
      method: input.method,
      resourceType: input.resourceType,
      status: input.status,
      mimeType: input.mimeType,
      responseHeaders: input.responseHeaders,
      capturedAt,
      bodyRef,
      bodyBytes: input.body.byteLength,
      bodyEncoding: textBody === null ? 'base64' : 'utf8',
      bodyText: textBody ?? undefined,
      bodyBase64: textBody === null ? Buffer.from(input.body).toString('base64') : undefined,
    };
  }

  private writeNetworkDerivedExtraction(
    pageId: string,
    input: ResponseBodyCapture,
    serialized: Record<string, unknown>,
    capturedAt: string,
  ): void {
    const parsed = this.tryParseJsonFromSerialized(serialized);
    if (!parsed) return;

    if (input.url.includes('claude.ai/api/') && /\/chat_conversations\/[^/?]+/.test(input.url) && !input.url.includes('chat_conversations_v2')) {
      const conversationArtifacts = this.extractClaudeConversationArtifacts(pageId, parsed, capturedAt, {
        preferCurrentLeaf: false,
      });
      this.indexArtifactCandidates(pageId, conversationArtifacts);
      this.writeArtifactsExtraction(
        pageId,
        this.prioritizeCurrentLeafArtifacts(conversationArtifacts),
      );
      this.writeExtractedJson(pageId, 'conversation.json', {
        kind: 'claude-conversation',
        pageId,
        url: input.url,
        capturedAt,
        requestId: input.requestId,
        status: input.status,
        mimeType: input.mimeType,
        data: parsed,
      });
    }

    if (input.url.includes('claude.ai/api/') && /\/artifacts\/[^/]+\/versions/.test(input.url)) {
      const artifacts = this.extractClaudeArtifacts(pageId, parsed, capturedAt);
      this.indexArtifactCandidates(pageId, artifacts);
      this.writeArtifactsExtraction(pageId, artifacts);
      this.writeExtractedJson(pageId, 'claude-artifact-versions.json', {
        kind: 'claude-artifact-versions',
        pageId,
        url: input.url,
        capturedAt,
        requestId: input.requestId,
        status: input.status,
        mimeType: input.mimeType,
        data: parsed,
      });
    }
  }

  private writeDownloadsExtraction(pageId: string, summary: PageSummary): void {
    const pageMeta = this.pages.get(pageId);
    if (!pageMeta) return;

    this.queue = this.queue
      .then(() => fs.promises.writeFile(
        path.join(pageMeta.extractedDir, 'downloads.json'),
        JSON.stringify({
          pageId,
          updatedAt: new Date().toISOString(),
          downloads: summary.downloads,
        }, null, 2),
        'utf8',
      ))
      .catch((error) => {
        console.error('[BrowserCapability][Trace] downloads extraction flush failed', error);
      });
  }

  private writeArtifactsExtraction(pageId: string, artifacts: ArtifactRecord[]): void {
    const pageMeta = this.pages.get(pageId);
    if (!pageMeta) return;
    const state = this.ensureExtractedState(pageId);
    const merged = new Map<string, ArtifactRecord>();
    for (const artifact of state.artifacts) {
      merged.set(artifact.artifactId, artifact);
    }
    for (const artifact of artifacts) {
      const existing = this.resolveArtifactMergeTarget(state, merged, artifact);
      const artifactId = existing?.artifactId ?? artifact.artifactId;
      merged.set(
        artifactId,
        existing ? this.mergeArtifactRecords(existing, { ...artifact, artifactId }) : artifact,
      );
    }
    state.artifacts = Array.from(merged.values());
    this.queue = this.queue
      .then(() => fs.promises.writeFile(
        path.join(pageMeta.extractedDir, 'artifacts.json'),
        JSON.stringify({
          pageId,
          updatedAt: new Date().toISOString(),
          artifacts: state.artifacts,
        }, null, 2),
        'utf8',
      ))
      .catch((error) => {
        console.error('[BrowserCapability][Trace] artifacts extraction flush failed', error);
      });
  }

  private indexArtifactCandidates(pageId: string, artifacts: ArtifactRecord[]): void {
    const state = this.ensureExtractedState(pageId);
    const merged = new Map<string, ArtifactRecord>();
    for (const artifact of state.artifactCandidates) {
      merged.set(artifact.artifactId, artifact);
    }
    for (const artifact of artifacts) {
      const existing = merged.get(artifact.artifactId);
      merged.set(
        artifact.artifactId,
        existing ? this.mergeArtifactRecords(existing, artifact) : artifact,
      );
    }
    state.artifactCandidates = Array.from(merged.values());
  }

  private mergeArtifactRecords(existing: ArtifactRecord, incoming: ArtifactRecord): ArtifactRecord {
    const merged: ArtifactRecord = {
      ...existing,
      ...incoming,
    };

    merged.frameId = incoming.frameId ?? existing.frameId;
    merged.messageUuid = incoming.messageUuid ?? existing.messageUuid;
    merged.messageIndex = incoming.messageIndex ?? existing.messageIndex;
    merged.sender = incoming.sender ?? existing.sender;
    merged.isCurrentLeaf = incoming.isCurrentLeaf ?? existing.isCurrentLeaf;
    merged.previewRef = incoming.previewRef ?? existing.previewRef;
    merged.domAnchorId = incoming.domAnchorId ?? existing.domAnchorId;
    merged.storageRef = incoming.storageRef ?? existing.storageRef;
    merged.url = incoming.url ?? existing.url;
    merged.mimeType = incoming.mimeType ?? existing.mimeType;
    merged.title = incoming.title ?? existing.title;

    const shouldPreserveExistingSurface =
      existing.surfaceScope === 'current-leaf-message' ||
      existing.surfaceScope === 'message-history';

    if (shouldPreserveExistingSurface && incoming.surfaceScope === 'download-event') {
      merged.surfaceScope = existing.surfaceScope;
      merged.surfaceRef = existing.surfaceRef ?? incoming.surfaceRef;
    } else {
      merged.surfaceScope = incoming.surfaceScope ?? existing.surfaceScope;
      merged.surfaceRef = incoming.surfaceRef ?? existing.surfaceRef;
    }

    merged.acquisition = this.mergeArtifactAcquisition(existing.acquisition, incoming.acquisition);
    merged.sourceLayer = incoming.sourceLayer;
    merged.createdAt = existing.createdAt ?? incoming.createdAt;

    return merged;
  }

  private mergeArtifactAcquisition(
    existing?: ArtifactRecord['acquisition'],
    incoming?: ArtifactRecord['acquisition'],
  ): ArtifactRecord['acquisition'] {
    const rank: Record<NonNullable<ArtifactRecord['acquisition']>, number> = {
      discovered: 1,
      downloadable: 2,
      downloaded: 3,
    };
    if (!existing) return incoming;
    if (!incoming) return existing;
    return rank[incoming] >= rank[existing] ? incoming : existing;
  }

  private writeExtractedJson(pageId: string, filename: string, payload: unknown): void {
    const pageMeta = this.pages.get(pageId);
    if (!pageMeta) return;
    this.queue = this.queue
      .then(() => fs.promises.writeFile(path.join(pageMeta.extractedDir, filename), JSON.stringify(payload, null, 2), 'utf8'))
      .catch((error) => {
        console.error('[BrowserCapability][Trace] extracted flush failed', error);
      });
  }

  private ensureExtractedState(pageId: string): GenericExtractedState {
    const existing = this.extractedState.get(pageId);
    if (existing) return existing;
    const state: GenericExtractedState = {
      artifacts: [],
      artifactCandidates: [],
      anchors: [],
      frames: [],
    };
    this.extractedState.set(pageId, state);
    return state;
  }

  private increment(bucket: Record<string, number>, key: string): void {
    bucket[key] = (bucket[key] ?? 0) + 1;
  }

  private safeGetDomain(rawUrl: string): string | null {
    try {
      return new URL(rawUrl).hostname;
    } catch {
      return null;
    }
  }

  private safeGetOrigin(rawUrl: string | undefined): string | undefined {
    if (!rawUrl) return undefined;
    try {
      return new URL(rawUrl).origin;
    } catch {
      return undefined;
    }
  }

  private safeSegment(value: string): string {
    return value.replace(/[^a-zA-Z0-9._:-]/g, '_');
  }

  private tryDecodeTextBody(body: Uint8Array, mimeType: string | undefined, url: string): string | null {
    const mime = String(mimeType || '').toLowerCase();
    const pathname = (() => {
      try {
        return new URL(url).pathname.toLowerCase();
      } catch {
        return '';
      }
    })();
    const looksText =
      mime.includes('json') ||
      mime.startsWith('text/') ||
      mime.includes('javascript') ||
      mime.includes('xml') ||
      mime.includes('svg') ||
      mime.includes('html') ||
      pathname.endsWith('.json') ||
      pathname.endsWith('.txt') ||
      pathname.endsWith('.svg') ||
      pathname.endsWith('.html');
    if (!looksText) return null;
    try {
      return new TextDecoder('utf-8', { fatal: false }).decode(body);
    } catch {
      return null;
    }
  }

  private tryParseJsonFromSerialized(serialized: Record<string, unknown>): unknown | null {
    const bodyText = typeof serialized.bodyText === 'string' ? serialized.bodyText : null;
    if (!bodyText) return null;
    try {
      return JSON.parse(bodyText);
    } catch {
      return null;
    }
  }

  private extractClaudeArtifacts(pageId: string, parsed: unknown, capturedAt: string): ArtifactRecord[] {
    const artifactVersions = this.readArtifactVersions(parsed);
    return artifactVersions.map((artifact, index) => {
      const artifactId = this.makeArtifactId({
        rawId: this.readString(artifact.id)
          ?? this.readString(artifact.uuid)
          ?? this.readString(artifact.artifact_id)
          ?? `claude-artifact-${index + 1}`,
        title: this.readString(artifact.title) ?? this.readString(artifact.name),
      });
      const mimeType = this.readString(artifact.mime_type) ?? this.readString(artifact.mimeType);
      const title = this.readString(artifact.title) ?? this.readString(artifact.name);
      return {
        artifactId,
        pageId,
        frameId: null,
        acquisition: this.readString(artifact.url) || this.readString(artifact.download_url) ? 'downloadable' : 'discovered',
        surfaceScope: 'unknown',
        surfaceRef: this.readString(artifact.id) ?? this.readString(artifact.uuid) ?? undefined,
        kind: this.classifyArtifactKind(mimeType, title),
        sourceLayer: 'network',
        title: title ?? artifactId,
        mimeType: mimeType ?? undefined,
        url: this.readString(artifact.url) ?? this.readString(artifact.download_url) ?? undefined,
        createdAt: this.readString(artifact.created_at) ?? capturedAt,
      };
    });
  }

  private extractClaudeConversationArtifacts(
    pageId: string,
    parsed: unknown,
    capturedAt: string,
    options?: { preferCurrentLeaf?: boolean },
  ): ArtifactRecord[] {
    if (!parsed || typeof parsed !== 'object') return [];
    const conversation = parsed as { chat_messages?: unknown[]; current_leaf_message_uuid?: unknown };
    const messages = Array.isArray(conversation.chat_messages)
      ? (conversation.chat_messages as unknown[])
      : [];
    const currentLeafMessageUuid = this.readString(conversation.current_leaf_message_uuid);
    const artifacts: ArtifactRecord[] = [];

    for (const message of messages) {
      if (!message || typeof message !== 'object') continue;
      const messageRecord = message as Record<string, unknown>;
      const messageUuid = this.readString(messageRecord.uuid) ?? `message-${artifacts.length + 1}`;
      const createdAt = this.readString(messageRecord.created_at) ?? capturedAt;
      const messageIndex = typeof messageRecord.index === 'number' ? messageRecord.index : undefined;
      const sender = this.readClaudeSender(messageRecord.sender);
      const isCurrentLeaf = currentLeafMessageUuid ? messageUuid === currentLeafMessageUuid : false;

      for (const artifact of this.extractClaudeMessageFileArtifacts(pageId, messageRecord, {
        messageUuid,
        messageIndex,
        sender,
        isCurrentLeaf,
      }, createdAt)) {
        artifacts.push(artifact);
      }

      const content = Array.isArray(messageRecord.content) ? messageRecord.content : [];
      for (const part of content) {
        if (!part || typeof part !== 'object') continue;
        const partRecord = part as Record<string, unknown>;
        const partType = this.readString(partRecord.type) ?? 'unknown';

        if (partType === 'tool_use') {
          const toolArtifact = this.extractClaudeToolUseArtifact(pageId, {
            messageUuid,
            messageIndex,
            sender,
            isCurrentLeaf,
          }, partRecord, createdAt);
          if (toolArtifact) artifacts.push(toolArtifact);
          continue;
        }

        if (partType === 'image' || partType === 'image_asset_pointer') {
          const imageArtifact = this.extractClaudeImageArtifact(pageId, {
            messageUuid,
            messageIndex,
            sender,
            isCurrentLeaf,
          }, partRecord, createdAt);
          if (imageArtifact) artifacts.push(imageArtifact);
        }
      }
    }

    if (options?.preferCurrentLeaf === false) return artifacts;
    return this.prioritizeCurrentLeafArtifacts(artifacts);
  }

  private extractClaudeMessageFileArtifacts(
    pageId: string,
    message: Record<string, unknown>,
    meta: {
      messageUuid: string;
      messageIndex?: number;
      sender: ArtifactRecord['sender'];
      isCurrentLeaf: boolean;
    },
    capturedAt: string,
  ): ArtifactRecord[] {
    const items = [
      ...(Array.isArray(message.attachments) ? message.attachments : []),
      ...(Array.isArray(message.files) ? message.files : []),
    ];
    const artifacts: ArtifactRecord[] = [];

    items.forEach((item, index) => {
      if (!item || typeof item !== 'object') return;
      const record = item as Record<string, unknown>;
      const title =
        this.readString(record.file_name)
        ?? this.readString(record.filename)
        ?? this.readString(record.name)
        ?? this.readString(record.title)
        ?? `${meta.messageUuid}-file-${index + 1}`;
      const mimeType =
        this.readString(record.mime_type)
        ?? this.readString(record.content_type)
        ?? this.readString(record.mimeType);
      const url =
        this.readString(record.download_url)
        ?? this.readString(record.url)
        ?? this.readString(record.asset_pointer);

      artifacts.push({
        artifactId: this.makeArtifactId({
          rawId: this.readString(record.id) ?? this.readString(record.uuid),
          title,
        }),
        pageId,
        frameId: null,
        messageUuid: meta.messageUuid,
        messageIndex: meta.messageIndex,
        sender: meta.sender,
        isCurrentLeaf: meta.isCurrentLeaf,
        acquisition: url ? 'downloadable' : 'discovered',
        surfaceScope: meta.isCurrentLeaf ? 'current-leaf-message' : 'message-history',
        surfaceRef: `conversation-message:${meta.messageUuid}`,
        kind: this.classifyArtifactKind(mimeType, title),
        sourceLayer: 'network',
        title,
        mimeType: mimeType ?? undefined,
        url: url ?? undefined,
        createdAt: capturedAt,
      });
    });

    return artifacts;
  }

  private extractClaudeToolUseArtifact(
    pageId: string,
    meta: {
      messageUuid: string;
      messageIndex?: number;
      sender: ArtifactRecord['sender'];
      isCurrentLeaf: boolean;
    },
    part: Record<string, unknown>,
    capturedAt: string,
  ): ArtifactRecord | null {
    const toolName = this.readString(part.name) ?? '';
    const input = part.input && typeof part.input === 'object' ? (part.input as Record<string, unknown>) : null;
    if (!input) return null;

    const title =
      this.readString(input.title)
      ?? this.readString(input.name)
      ?? this.readString(part.id)
      ?? `${meta.messageUuid}-${toolName || 'tool-artifact'}`;
    const widgetCode = this.readString(input.widget_code);
    const mimeType = this.detectWidgetMimeType(widgetCode);
    const kind = toolName.includes('show_widget')
      ? this.classifyArtifactKind(mimeType, title, widgetCode)
      : 'unknown';

    if (kind === 'unknown' && !widgetCode) return null;

    return {
      artifactId: this.makeArtifactId({
        rawId: this.readString(part.id),
        title,
      }),
      pageId,
      frameId: null,
      messageUuid: meta.messageUuid,
      messageIndex: meta.messageIndex,
      sender: meta.sender,
      isCurrentLeaf: meta.isCurrentLeaf,
      acquisition: kind === 'image' || kind === 'widget' ? 'downloadable' : 'discovered',
      surfaceScope: meta.isCurrentLeaf ? 'current-leaf-message' : 'message-history',
      surfaceRef: `conversation-message:${meta.messageUuid}`,
      kind,
      sourceLayer: 'network',
      title,
      mimeType: mimeType ?? undefined,
      createdAt: capturedAt,
      previewRef: widgetCode ? 'inline:conversation-tool-use' : undefined,
    };
  }

  private extractClaudeImageArtifact(
    pageId: string,
    meta: {
      messageUuid: string;
      messageIndex?: number;
      sender: ArtifactRecord['sender'];
      isCurrentLeaf: boolean;
    },
    part: Record<string, unknown>,
    capturedAt: string,
  ): ArtifactRecord | null {
    const url =
      this.readString(part.url)
      ?? this.readString(part.asset_pointer)
      ?? this.readString(part.image_url);
    if (!url) return null;
    const title = this.readString(part.title) ?? `${meta.messageUuid}-image`;
    const mimeType = this.readString(part.content_type) ?? this.inferMimeTypeFromNameOrUrl(title, url);
    return {
      artifactId: this.makeArtifactId({ rawId: url, title }),
      pageId,
      frameId: null,
      messageUuid: meta.messageUuid,
      messageIndex: meta.messageIndex,
      sender: meta.sender,
      isCurrentLeaf: meta.isCurrentLeaf,
      acquisition: 'downloadable',
      surfaceScope: meta.isCurrentLeaf ? 'current-leaf-message' : 'message-history',
      surfaceRef: `conversation-message:${meta.messageUuid}`,
      kind: 'image',
      sourceLayer: 'network',
      title,
      mimeType: mimeType ?? 'image/*',
      url,
      createdAt: capturedAt,
    };
  }

  private toArtifactFromDownload(download: DownloadState): ArtifactRecord {
    return {
      artifactId: this.makeArtifactId({
        rawId: download.downloadId,
        title: download.filename,
      }),
      pageId: download.pageId,
      frameId: download.frameId ?? null,
      acquisition: 'downloaded',
      surfaceScope: 'download-event',
      surfaceRef: download.downloadId,
      kind: this.classifyArtifactKind(download.mimeType, download.filename),
      sourceLayer: 'download',
      title: download.filename,
      mimeType: download.mimeType,
      url: download.url,
      storageRef: download.storageRef,
      createdAt: download.finishedAt ?? download.startedAt,
    };
  }

  private prioritizeCurrentLeafArtifacts(artifacts: ArtifactRecord[]): ArtifactRecord[] {
    const currentLeafArtifacts = artifacts.filter((artifact) => artifact.isCurrentLeaf);
    if (currentLeafArtifacts.length > 0) return currentLeafArtifacts;
    return artifacts;
  }

  private resolveArtifactMergeTarget(
    state: GenericExtractedState,
    merged: Map<string, ArtifactRecord>,
    incoming: ArtifactRecord,
  ): ArtifactRecord | undefined {
    const exact = merged.get(incoming.artifactId);
    if (exact) return exact;
    if (incoming.sourceLayer !== 'download') return undefined;

    const normalizedIncomingTitle = this.normalizeArtifactLabel(incoming.title);
    if (!normalizedIncomingTitle) return undefined;

    const candidates = new Map<string, ArtifactRecord>();
    for (const artifact of state.artifacts) {
      candidates.set(artifact.artifactId, artifact);
    }
    for (const artifact of state.artifactCandidates) {
      if (!candidates.has(artifact.artifactId)) {
        candidates.set(artifact.artifactId, artifact);
      }
    }

    const matches = Array.from(candidates.values()).filter((artifact) => {
      const candidateTitle = this.normalizeArtifactLabel(artifact.title);
      if (!candidateTitle || candidateTitle !== normalizedIncomingTitle) return false;
      if (artifact.kind !== incoming.kind) return false;
      return true;
    });
    if (matches.length === 0) return undefined;

    matches.sort((left, right) => this.scoreArtifactMatch(right) - this.scoreArtifactMatch(left));
    return matches[0];
  }

  private scoreArtifactMatch(artifact: ArtifactRecord): number {
    let score = 0;
    if (artifact.isCurrentLeaf) score += 100;
    if (artifact.surfaceScope === 'current-leaf-message') score += 20;
    if (artifact.sourceLayer === 'network') score += 10;
    if (artifact.acquisition === 'downloadable') score += 5;
    return score;
  }

  private normalizeArtifactLabel(value?: string | null): string | null {
    const label = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return label.length > 0 ? label : null;
  }

  private readArtifactVersions(parsed: unknown): Array<Record<string, unknown>> {
    if (!parsed || typeof parsed !== 'object') return [];
    const value = (parsed as { artifact_versions?: unknown }).artifact_versions;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private readClaudeSender(value: unknown): ArtifactRecord['sender'] {
    if (value === 'human' || value === 'assistant') return value;
    if (value === 'system') return value;
    return 'unknown';
  }

  private classifyArtifactKind(
    mimeType?: string | null,
    title?: string | null,
    sourceText?: string | null,
  ): ArtifactRecord['kind'] {
    const mime = String(mimeType || '').toLowerCase();
    const name = String(title || '').toLowerCase();
    if (mime.startsWith('image/')) return 'image';
    if (mime.includes('svg')) return 'image';
    if (mime.includes('html')) return sourceText?.includes('<svg') ? 'image' : 'widget';
    if (mime.includes('markdown') || mime.includes('md')) return 'text';
    if (mime.includes('json') || mime.includes('javascript') || mime.includes('typescript') || name.endsWith('.ts') || name.endsWith('.js')) {
      return 'code';
    }
    if (mime.includes('csv')) return 'table';
    if (mime.includes('pdf') || mime.includes('zip') || mime.includes('octet-stream')) return 'file';
    if (name.endsWith('.svg')) return 'image';
    if (name.endsWith('.html') || name.endsWith('.htm')) return sourceText?.includes('<svg') ? 'image' : 'widget';
    if (name.endsWith('.md') || name.endsWith('.txt')) return 'text';
    if (mime.startsWith('text/')) return 'text';
    if (sourceText?.includes('<svg')) return 'image';
    return 'unknown';
  }

  private detectWidgetMimeType(widgetCode: string | null): string | null {
    if (!widgetCode) return null;
    if (widgetCode.includes('<svg')) return 'image/svg+xml';
    if (widgetCode.includes('<div') || widgetCode.includes('<style') || widgetCode.includes('<script')) return 'text/html';
    return null;
  }

  private inferMimeTypeFromNameOrUrl(name?: string | null, url?: string | null): string | null {
    const value = `${name || ''} ${url || ''}`.toLowerCase();
    if (value.includes('.svg')) return 'image/svg+xml';
    if (value.includes('.png')) return 'image/png';
    if (value.includes('.jpg') || value.includes('.jpeg')) return 'image/jpeg';
    if (value.includes('.gif')) return 'image/gif';
    if (value.includes('.pdf')) return 'application/pdf';
    return null;
  }

  private makeArtifactId(input: { rawId?: string | null; title?: string | null }): string {
    const titleBase = String(input.title || '')
      .replace(/\.[a-z0-9]+$/i, '')
      .trim();
    if (titleBase) {
      return `artifact:${this.safeSegment(titleBase)}`;
    }
    const rawId = this.readString(input.rawId);
    if (rawId) return `artifact:${this.safeSegment(rawId)}`;
    return `artifact:${Date.now().toString(36)}`;
  }

  private isKeyEvent(event: NetworkTraceEntry): boolean {
    const url = event.url;
    return (
      url.includes('chat_conversations') ||
      url.includes('/artifacts/') ||
      url.includes('claudemcpcontent.com/mcp_apps') ||
      url.includes('news.google.com/home')
    );
  }
}

export const browserCapabilityTraceWriter = new BrowserCapabilityTraceWriter();
