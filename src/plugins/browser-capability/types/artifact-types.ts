import type { Rect } from './browser-state';

export type DomAnchor = {
  anchorId: string;
  pageId: string;
  selectorHint?: string;
  textPreview?: string;
  rect?: Rect | null;
  role?: string;
  headingPath?: string[];
  ordinal?: number;
};

export type ArtifactRecord = {
  artifactId: string;
  pageId: string;
  frameId?: string | null;
  messageUuid?: string;
  messageIndex?: number;
  sender?: 'human' | 'assistant' | 'system' | 'unknown';
  isCurrentLeaf?: boolean;
  acquisition?: 'discovered' | 'downloadable' | 'downloaded';
  surfaceScope?: 'current-leaf-message' | 'message-history' | 'download-event' | 'frame-main' | 'frame-subframe' | 'unknown';
  surfaceRef?: string;
  kind: 'text' | 'image' | 'file' | 'widget' | 'chart' | 'table' | 'code' | 'unknown';
  sourceLayer: 'network' | 'download' | 'dom' | 'frame' | 'render';
  title?: string;
  mimeType?: string;
  url?: string;
  domAnchorId?: string;
  storageRef?: string;
  previewRef?: string;
  createdAt: string;
};
