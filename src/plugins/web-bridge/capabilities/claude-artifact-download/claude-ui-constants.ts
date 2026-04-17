/**
 * claude-ui-constants.ts
 *
 * All reverse-engineered Claude DOM / UI constants. Claude changes its UI
 * occasionally — when the artifact download module breaks, this is the first
 * file to re-verify.
 *
 * Last verified: 2026-04-15 against claude.ai web build.
 */

// ─────────────────────────────────────────────────────────────
// Card-form artifact (.group/artifact-block)
// ─────────────────────────────────────────────────────────────

/**
 * Root selector for card-form artifacts in the conversation stream.
 * Tailwind uses "group/artifact-block" — the slash needs CSS-escaping
 * when written as a class selector, which breaks badly when the
 * selector crosses JSON.stringify into an injected script. Prefer the
 * attribute-substring selector below for guest-side code.
 */
export const CARD_ROOT_SELECTOR = '[class*="group/artifact-block"]';

/**
 * Download button inside a card. aria-label shape is `Download {title}`,
 * e.g. "Download Main", "Download First principles diagram".
 */
export const CARD_DOWNLOAD_BUTTON_SELECTOR = 'button[aria-label^="Download "], button[title*="Download"], button';

/**
 * Element containing the artifact title, e.g. "Main", "Example".
 */
export const CARD_TITLE_SELECTOR = '.leading-tight.text-sm';

/**
 * Element containing the "kind · format" label, e.g. "Code · GO",
 * "Document · MD", "Diagram · MERMAID", "Code · HTML".
 */
export const CARD_KIND_LABEL_SELECTOR = '.text-xs.text-text-400';

/**
 * Utility snippet for guest-side scripts: filter a querySelectorAll result
 * down to only top-level artifact card roots, excluding nested descendants
 * that inherit partial "artifact-block" class names.
 */
export const CARD_ROOT_FILTER_FN = `
  function(list) {
    return Array.from(list).filter(function(el) {
      var p = el.parentElement;
      while (p) {
        var cls = '';
        try { cls = (p.className && String(p.className)) || ''; } catch (e) {}
        if (cls.indexOf('group/artifact-block') >= 0) return false;
        p = p.parentElement;
      }
      return true;
    });
  }
`;

// ─────────────────────────────────────────────────────────────
// Iframe-form artifact (cross-origin MCP iframe)
// ─────────────────────────────────────────────────────────────

/**
 * Selector for the inline-rendered artifact iframes. Subdomain is a per-
 * conversation hash (not per-artifact), so multiple iframes share the
 * same hostname prefix — distinguish them by DOM order or full URL query.
 */
export const IFRAME_SELECTOR = 'iframe[src*="claudemcpcontent"]';

/**
 * Menu item offsets relative to the iframe's "..." hotspot at
 * (rect.right - 30, rect.top + 30). The menu expands down-and-left.
 *
 * Verified on claude.ai 2026-04-15. The 36px row height is stable.
 */
export const MENU_OFFSETS = {
  copyToClipboard: { dx: -80, dy: 45 },   // row 1 → PNG via clipboard
  downloadFile:    { dx: -80, dy: 81 },   // row 2 → SVG for iframe, source for non-iframe
  saveAsArtifact:  { dx: -80, dy: 117 },  // row 3 → converts iframe to new card (§11 only)
} as const;

/**
 * Timings for the CDP hover-and-click sequence. Shortening any of these
 * has been observed to fail intermittently (Radix UI needs dwell time to
 * consider a hover "stable").
 */
export const CDP_TIMINGS = {
  /** After the 3-segment hover trajectory, before the menu is assumed open. */
  hoverToMenuOpenMs: 250,
  /** After moving to a menu item, before pressing the mouse button. */
  menuItemHoverToClickMs: 100,
  /** After clicking Copy-to-clipboard, before reading the clipboard image. */
  clipboardReadDelayMs: 700,
  /** Iframe must be taller than this to count as "mounted" (lazy-load check). */
  iframeMinHeight: 100,
  /** Iframe height must stay unchanged for this long to count as "stable". */
  iframeStableMs: 400,
  /** Max wait for iframe to reach stable height. */
  iframeStabilizeTimeoutMs: 3000,
} as const;

// ─────────────────────────────────────────────────────────────
// SVG post-processing
// ─────────────────────────────────────────────────────────────

/**
 * CSS variable fallback values for Claude-downloaded SVGs. Claude's SVGs
 * reference `var(--color-*)` tokens that are only defined in the live
 * Claude page — embedding the SVG elsewhere loses them, so arrows /
 * borders disappear. We inject these fallbacks into `<defs>` at download
 * time.
 *
 * Values sampled from Claude's dark theme as of 2026-04-15. Grow this set
 * as more SVG artifacts are encountered with missing variables.
 */
export const SVG_CSS_FALLBACK_VARS: Record<string, string> = {
  '--color-border-tertiary': 'rgba(222, 220, 209, 0.15)',
  '--color-border-secondary': 'rgba(222, 220, 209, 0.3)',
  '--color-text-primary': '#1a1a1a',
  '--color-bg-primary': '#ffffff',
};
