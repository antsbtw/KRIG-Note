/**
 * AI ↔ Note Bridge — shared types
 */

import type { AIServiceId } from '../../shared/types/ai-service-types';

/** A single user→assistant exchange in normalized form. */
export interface NormalizedTurn {
  /** Stable id used for dedup (Claude message uuid / ChatGPT id / Gemini responseId). */
  id: string;
  /** Index in conversation order, 0-based. */
  index: number;
  userMessage: string;
  /** Assistant Markdown after Artifact processing (for live: callout; for save: PNG). */
  markdown: string;
}

/** Source metadata attached to every emitted turn. */
export interface TurnSource {
  serviceId: AIServiceId;
  serviceName: string;
  conversationId: string | null;
}

/** Per-turn pipeline state used by the save-to-note flow. */
export type TurnState =
  | 'pending'
  | 'fetching-text'
  | 'awaiting-iframes'
  | 'capturing-images'
  | 'verifying'
  | 'ready'
  | 'failed'
  | 'cancelled';

/**
 * Pipeline progress reported to the UI for the freeze overlay.
 * `total` is the count of turns that need processing; `current` is
 * 1-based as displayed (current=3 of total=8 means 3rd turn is in
 * flight, 0..1 already done).
 */
export interface SaveProgress {
  current: number;
  total: number;
  /** Short label shown inside the overlay. */
  status: string;
  /** Call to abort at the next safe point. */
  cancel: () => void;
}

/** Result of `verifyTurn` — extracted vs expected counts. */
export interface VerifyResult {
  ok: boolean;
  placeholderCount: number;
  expectedIframes: number;
  capturedImages: number;
  /** When ok=false, a short reason for diagnostics. */
  reason?: string;
}
