/**
 * Public types for the Claude artifact download module.
 *
 * Kept in a dedicated file so the module entry (claude-artifact-download.ts)
 * and internal files can share them without circular imports.
 */

export type ClaudeArtifactKind =
  | { form: 'card'; cardType: 'code'; language: string }
  | { form: 'card'; cardType: 'document'; format: string }   // md / txt
  | { form: 'card'; cardType: 'diagram'; format: string }    // mermaid
  | { form: 'card'; cardType: 'html' }
  | { form: 'iframe'; exportAs: 'svg' }
  | { form: 'iframe'; exportAs: 'png' };

export interface ClaudeArtifactRef {
  /** Already-resolved card element (fastest, skips DOM scan). */
  cardEl?: HTMLElement;
  /** Already-resolved iframe element. */
  iframeEl?: HTMLIFrameElement;
  /** Nth artifact in document order (card + standalone iframe, merged). */
  ordinal?: number;
}

export interface ClaudeArtifactDownload {
  /** Raw bytes of the downloaded artifact, byte-exact. */
  bytes: Uint8Array;
  mime: string;
  filename: string;
  kind: ClaudeArtifactKind;
  title: string;
  meta: {
    pathTaken: 'card-button-click' | 'iframe-cdp-menu-svg' | 'iframe-cdp-menu-png';
    /** Set on iframe-svg path if latin1→utf8 reverse decoding was applied. */
    encodingFixed?: boolean;
    /** Set on iframe-svg path if CSS variable fallback was injected. */
    cssFallbackInjected?: boolean;
    /** SVG viewBox / natural size, useful for picking a render height. */
    naturalSize?: { w: number; h: number };
    /** Wall-clock duration from trigger to download complete. */
    elapsedMs: number;
  };
}

export type ClaudeArtifactDownloadErrorCode =
  | 'no-such-artifact'
  | 'card-button-not-found'
  | 'iframe-not-in-viewport'
  | 'cdp-menu-failed'
  | 'download-timeout'
  | 'download-empty'
  | 'unknown-card-type'
  | 'wrong-form';

export class ClaudeArtifactDownloadError extends Error {
  constructor(
    public readonly code: ClaudeArtifactDownloadErrorCode,
    public readonly detail?: Record<string, unknown>,
  ) {
    super(`[claude-artifact-download] ${code}${detail ? ': ' + JSON.stringify(detail) : ''}`);
    this.name = 'ClaudeArtifactDownloadError';
  }
}
