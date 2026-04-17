import type {
  BrowserState,
  FrameState,
  Rect,
  SelectionState,
} from './browser-state';
import type { ArtifactRecord, DomAnchor } from './artifact-types';
import type { InteractionTarget, WaitCondition } from './interaction-types';
import type { NetworkEvent, NetworkRecord } from './network-types';
import type { CaptureTraceInput, MediaPutInput, MediaPutResult, NoteAppendInput } from './output-types';
import type { PageLifecycleEvent, PageResourceLease } from './core-types';

export interface IBrowserCapabilityLayer {
  core: IBrowserCoreAPI;
  state: IBrowserStateAPI;
  network: IBrowserNetworkAPI;
  runtime: IBrowserRuntimeAPI;
  render: IBrowserRenderAPI;
  interaction: IBrowserInteractionAPI;
  artifact: IBrowserArtifactAPI;
  persistence: IBrowserPersistenceAPI;
}

export interface IBrowserCoreAPI {
  subscribeLifecycle(
    listener: (event: PageLifecycleEvent) => void | Promise<void>,
  ): Promise<() => void>;
}

export interface IBrowserStateAPI {
  getPageState(pageId: string): Promise<BrowserState>;
  listFrames(pageId: string): Promise<FrameState[]>;
  getActiveFrame(pageId: string): Promise<FrameState | null>;
  acquirePageLease(input: {
    pageId?: string;
    owner: 'user' | 'agent' | 'system';
    purpose: string;
    visibility?: 'foreground' | 'background' | 'hidden';
    partition?: string;
    reusable?: boolean;
    ttlMs?: number;
  }): Promise<PageResourceLease>;
  releasePageLease(leaseId: string): Promise<void>;
  listLeases(): Promise<PageResourceLease[]>;
}

export interface IBrowserNetworkAPI {
  listRequests(pageId: string, filter?: {
    frameId?: string;
    urlIncludes?: string;
    resourceType?: string;
    limit?: number;
  }): Promise<NetworkRecord[]>;
  getResponseBody(requestId: string): Promise<Uint8Array | null>;
  getResponseBodyByRef(bodyRef: string): Promise<Uint8Array | null>;
  waitForRequest(pageId: string, matcher: {
    urlIncludes?: string;
    method?: string;
    resourceType?: string;
    timeoutMs?: number;
  }): Promise<NetworkRecord | null>;
  captureSSE(pageId: string, config: {
    urlIncludes: string;
    parser: 'text-delta' | 'json-line' | 'raw';
  }): Promise<void>;
  listDownloads(pageId: string): Promise<BrowserState['downloads']>;
  subscribe(
    pageId: string,
    config: {
      kinds: Array<NetworkEvent['kind']>;
      frameId?: string;
      urlIncludes?: string;
    },
    listener: (event: NetworkEvent) => void | Promise<void>,
  ): Promise<() => void>;
}

export interface IBrowserRuntimeAPI {
  eval<T = unknown>(pageId: string, script: string): Promise<T>;
  query(pageId: string, selector: string): Promise<DomAnchor | null>;
  queryAll(pageId: string, selector: string): Promise<DomAnchor[]>;
  getText(pageId: string, selector?: string): Promise<string>;
  getHTML(pageId: string, selector?: string): Promise<string>;
  getSelection(pageId: string): Promise<SelectionState | null>;
  locateSections(pageId: string, headings: string[]): Promise<Array<{
    heading: string;
    anchor: DomAnchor;
  }>>;
}

export interface IBrowserRenderAPI {
  capturePage(pageId: string): Promise<Uint8Array>;
  captureRect(pageId: string, rect: Rect): Promise<Uint8Array>;
  captureRects(pageId: string, rects: Rect[]): Promise<Uint8Array[]>;
  captureFrame(pageId: string, frameId: string): Promise<Uint8Array | null>;
  exportSVG(pageId: string, selector: string): Promise<string | null>;
}

export interface IBrowserInteractionAPI {
  click(pageId: string, target: InteractionTarget): Promise<void>;
  rightClick(pageId: string, target: InteractionTarget): Promise<void>;
  type(pageId: string, selector: string, text: string): Promise<void>;
  press(pageId: string, key: string): Promise<void>;
  scrollTo(pageId: string, y: number): Promise<void>;
  scrollBy(pageId: string, dy: number): Promise<void>;
  hover(pageId: string, selector: string): Promise<void>;
  waitFor(pageId: string, condition: WaitCondition): Promise<boolean>;
}

export interface IBrowserArtifactAPI {
  probe(pageId: string, scope?: {
    selection?: SelectionState;
    headings?: string[];
    rects?: Rect[];
  }): Promise<ArtifactRecord[]>;
  downloadAttachment(pageId: string, artifactId: string): Promise<BrowserState['downloads'][number] | null>;
  captureVisualArtifact(pageId: string, artifactId: string): Promise<ArtifactRecord | null>;
  resolveArtifactsForSections(pageId: string, sections: Array<{
    heading: string;
    anchor?: DomAnchor;
  }>): Promise<ArtifactRecord[]>;
}

export interface IBrowserPersistenceAPI {
  writeCaptureTrace(input: CaptureTraceInput): Promise<string>;
  putMedia(input: MediaPutInput): Promise<MediaPutResult>;
  appendToNote(input: NoteAppendInput): Promise<void>;
}
