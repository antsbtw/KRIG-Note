/**
 * AI ↔ Note Bridge — public surface.
 *
 * Manual extraction path only:
 *   - Right-click "提取到笔记" freezes the AI page, downloads
 *     artifacts as needed, and appends the selected turn into Note.
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
} from './pipeline/claude-artifacts';
