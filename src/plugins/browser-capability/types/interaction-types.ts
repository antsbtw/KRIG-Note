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

