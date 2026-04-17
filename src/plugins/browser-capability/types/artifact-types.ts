import type { Rect } from './browser-state';

export type DomAnchor = {
  anchorId: string;
  pageId: string;
  frameId?: string | null;
  frameUrl?: string;
  frameOrigin?: string;
  selectorHint?: string;
  textPreview?: string;
  rect?: Rect | null;
  role?: string;
  headingPath?: string[];
  ordinal?: number;
  visible?: boolean;
};

export type ArtifactRecord = {
  artifactId: string;
  pageId: string;
  frameId?: string | null;
  frameUrl?: string;
  frameOrigin?: string;
  frameKind?: 'main' | 'subframe' | 'guest' | 'unknown';
  messageUuid?: string;
  messageIndex?: number;
  toolUseId?: string;
  sender?: 'human' | 'assistant' | 'system' | 'unknown';
  isCurrentLeaf?: boolean;
  acquisition?: 'discovered' | 'downloadable' | 'downloaded';
  surfaceScope?: 'current-leaf-message' | 'message-history' | 'download-event' | 'frame-main' | 'frame-subframe' | 'unknown';
  surfaceRef?: string;
  kind: 'text' | 'image' | 'file' | 'widget' | 'chart' | 'table' | 'code' | 'unknown';
  sourceLayer: 'network' | 'download' | 'dom' | 'frame' | 'render';
  title?: string;
  mimeType?: string;
  byteLength?: number;
  sha256?: string;
  extension?: string;
  mtime?: string;
  url?: string;
  domAnchorId?: string;
  storageRef?: string;
  previewRef?: string;
  createdAt: string;
};
