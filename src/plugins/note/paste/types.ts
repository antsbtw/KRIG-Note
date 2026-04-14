/**
 * Paste module shared types.
 *
 * A PasteHandler is the per-source hook the dispatcher uses to decide
 * how to convert one clipboard payload into a Markdown string (which is
 * then fed through md-to-pm). Handlers are registered in priority order
 * and the first that `detect()`s `true` handles the paste.
 */

export interface PasteClipboard {
  /** Raw `text/plain` flavor from the clipboard, may be empty. */
  plain: string;
  /** Raw `text/html` flavor from the clipboard, may be empty. */
  html: string;
  /** Whether the clipboard also carries an image file (PNG bitmap). */
  hasImage: boolean;
}

export interface PasteResult {
  /** Markdown string to feed to md-to-pm. Empty string means "no-op;
   *  let the default PM paste handler run". */
  markdown: string;
  /** Optional: mark what handler produced this, for telemetry / debug. */
  via: string;
}

export interface PasteHandler {
  /** Stable unique name, e.g. "word", "notion", "generic". */
  name: string;
  /**
   * Return true if this handler wants to take ownership of the paste.
   * Detection should be cheap and side-effect free — just check the
   * HTML head for source-specific signatures (mso-*, notion-*, katex-
   * mathml, …).
   */
  detect(clipboard: PasteClipboard): boolean;
  /**
   * Convert the clipboard payload to Markdown. Returning an empty
   * string from a handler that `detect()`ed true is treated as a soft
   * skip: the dispatcher will continue trying lower-priority handlers.
   */
  toMarkdown(clipboard: PasteClipboard): PasteResult;
}
