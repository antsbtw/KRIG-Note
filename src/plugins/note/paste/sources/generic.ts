import type { PasteClipboard, PasteHandler, PasteResult } from '../types';
import { htmlToMarkdown } from '../html-to-markdown';

/**
 * Generic fallback — the catch-all handler used when no source-specific
 * handler claimed the paste. Strategy:
 *
 *   1. If text/html has real structural markup (table/headings) → run
 *      it through htmlToMarkdown. Preserves tables copied from Word /
 *      Excel / Google Docs when no dedicated handler exists yet.
 *   2. Else if text/plain looks like Markdown (AI assistants, docs
 *      sites with copy-as-markdown) → use text/plain directly.
 *   3. Else → return plain text unchanged; md-to-pm will produce a
 *      single paragraph block.
 *
 * Anchor-heavy HTML without real structure (Wikipedia prose) is
 * deliberately skipped from the HTML path — it fragmented badly
 * through the converter in earlier iterations. We'd rather lose the
 * inline links than fragment the paragraph.
 */
export const genericHandler: PasteHandler = {
  name: 'generic',

  detect() { return true; },  // always matches; dispatcher uses it last

  toMarkdown(cb: PasteClipboard): PasteResult {
    if (cb.html && hasStructuralHtml(cb.html)) {
      return { markdown: htmlToMarkdown(cb.html), via: 'generic/html' };
    }
    if (cb.plain) {
      return { markdown: cb.plain, via: 'generic/plain' };
    }
    return { markdown: '', via: 'generic/empty' };
  },
};

function hasStructuralHtml(html: string): boolean {
  return /<\s*(table|thead|tbody|tr|th|td|h[1-6])\b/i.test(html);
}
