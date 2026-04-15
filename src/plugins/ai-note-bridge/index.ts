/**
 * AI ↔ Note Bridge — public surface.
 *
 * Two modes:
 *   - Live chat sync (auto, fires on SSE message_stop) — text only,
 *     Artifacts replaced by a "click Claude's copy button" callout.
 *   - Save-to-Note button (manual, freezes the AI page) — full
 *     fidelity including Artifact PNGs via CDP.
 *
 * AIWebView.tsx is the only consumer; it imports from here and
 * mounts the SaveToNoteButton in its toolbar.
 */

export type {
  NormalizedTurn,
  TurnSource,
  TurnState,
  SaveProgress,
  VerifyResult,
} from './types';

export {
  processClaudeArtifactsLive,
  processClaudeArtifactsFull,
} from './pipeline/claude-artifacts';

export { startSseTrigger } from './triggers/sse-trigger';
export type { SseTriggerHandle } from './triggers/sse-trigger';
