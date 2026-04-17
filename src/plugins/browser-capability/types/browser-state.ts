export type BrowserVisibility = 'foreground' | 'background' | 'hidden';

export type BrowserOwner = 'user' | 'agent' | 'system';

export type ReadyState = 'loading' | 'interactive' | 'complete' | 'unknown';

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SelectionState = {
  text: string;
  html?: string;
  rects: Rect[];
  anchorNodeText?: string;
  focusNodeText?: string;
};

export type FrameState = {
  frameId: string;
  parentFrameId?: string | null;
  url: string;
  origin: string;
  visible: boolean;
  bounds?: Rect | null;
  kind: 'main' | 'subframe' | 'guest' | 'unknown';
};

export type BrowserState = {
  pageId: string;
  url: string;
  title: string;
  partition: string;
  loading: boolean;
  readyState: ReadyState;
  visibility: BrowserVisibility;
  owner: BrowserOwner;
  reusable: boolean;
  frames: FrameState[];
  downloads: DownloadState[];
  selection?: SelectionState | null;
  capturedAt: string;
};

export type DownloadState = {
  downloadId: string;
  pageId: string;
  frameId?: string | null;
  url: string;
  filename: string;
  mimeType?: string;
  byteLength?: number;
  sha256?: string;
  extension?: string;
  mtime?: string;
  storageRef?: string;
  status: 'started' | 'completed' | 'failed' | 'cancelled';
  error?: string;
  startedAt: string;
  finishedAt?: string;
};
