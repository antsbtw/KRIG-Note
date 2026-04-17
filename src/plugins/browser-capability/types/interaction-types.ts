import type { Rect } from './browser-state';

export type InteractionTarget = {
  selector?: string;
  anchorId?: string;
  rect?: Rect;
};

export type WaitCondition = {
  selector?: string;
  textIncludes?: string;
  urlIncludes?: string;
  timeoutMs?: number;
};

export type PageInteraction = {
  interactionId: string;
  pageId: string;
  anchorId?: string;
  frameId?: string | null;
  artifactId?: string;
  kind: 'click' | 'input' | 'select' | 'navigate' | 'toggle' | 'unknown';
  surfaceScope?: 'artifact' | 'composer' | 'sidebar' | 'header' | 'message' | 'global' | 'unknown';
  role?: string;
  label?: string;
  selectorHint?: string;
  textPreview?: string;
  rect?: Rect | null;
  visible?: boolean;
  enabled?: boolean;
};
