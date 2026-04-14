/**
 * smart-paste — normalize clipboard content into KRIG markdown atoms.
 *
 * Clipboard data comes in two common flavors:
 *
 *   text/plain
 *     AI assistants (Claude / ChatGPT / Gemini), GitHub code viewers,
 *     and anything that treats text as source tend to put **Markdown**
 *     in text/plain. If we feed that through md-to-pm the result is
 *     a proper block tree (code fences, math, lists, etc).
 *
 *   text/html
 *     Wiki / blog / docs / most browsers put rendered HTML here. The
 *     text/plain flavor for those is usually a flat single-paragraph
 *     string with all links and inline marks stripped. To preserve
 *     structure we parse the HTML back to Markdown first and then
 *     feed it to md-to-pm.
 *
 * Dispatcher:
 *   1. Images in clipboard  → let paste-media handle it (earlier in
 *      NoteEditor.buildPlugins).
 *   2. `text/plain` looks like Markdown (has newlines or common
 *      markdown markers) → use text/plain directly.
 *   3. Else if `text/html` has structural elements → html → markdown.
 *   4. Else (boring plain text, single word, etc) → default PM paste.
 *
 * Both Markdown sources go through the same md-to-pm pipeline via
 * the MD_TO_PM_NODES IPC, producing a ProseMirror fragment that
 * replaces the current selection in-place.
 */

import { Plugin } from 'prosemirror-state';
import { Slice, Fragment } from 'prosemirror-model';
import { htmlToMarkdown } from '../utils/html-to-markdown';

interface ViewAPILike {
  markdownToPMNodes?: (markdown: string) => Promise<unknown[]>;
}

export function smartPastePlugin(): Plugin {
  return new Plugin({
    props: {
      handlePaste(view, event) {
        const cd = event.clipboardData;
        if (!cd) return false;

        // Defer to paste-media for image content.
        for (const item of Array.from(cd.items)) {
          if (item.kind === 'file' && item.type.startsWith('image/')) return false;
        }

        const plain = cd.getData('text/plain');
        const html = cd.getData('text/html');

        // Path 1: text/plain looks like raw Markdown → use it directly.
        // Path 2: text/html has rich structure → html → markdown.
        // Else: let PM's default handler insert the plain text.
        let markdown = '';
        if (plain && looksLikeMarkdown(plain)) {
          markdown = plain;
        } else if (html && looksLikeRichHtml(html)) {
          markdown = htmlToMarkdown(html);
        }
        if (!markdown || !markdown.trim()) return false;

        // Convert asynchronously via existing pipeline; we've already
        // told ProseMirror we handled the event (return true) so default
        // paste is cancelled.
        const api: ViewAPILike | undefined = (window as any).viewAPI;
        if (!api?.markdownToPMNodes) {
          // Pipeline not wired yet; fall back to inserting raw markdown
          // as plain text (better than losing content entirely).
          const tr = view.state.tr.insertText(markdown, view.state.selection.from, view.state.selection.to);
          view.dispatch(tr);
          return true;
        }

        api.markdownToPMNodes(markdown).then(nodes => {
          if (!Array.isArray(nodes) || nodes.length === 0) return;
          try {
            const { state } = view;
            const { schema } = state;
            // Hydrate PM nodes from the JSON shapes main sent back.
            const pmNodes = nodes
              .map(n => {
                try { return schema.nodeFromJSON(n as any); }
                catch { return null; }
              })
              .filter((n): n is NonNullable<typeof n> => !!n);
            if (pmNodes.length === 0) return;

            // Insert all nodes in one replace, using a Slice built from a
            // Fragment. This is the only correct way to paste multiple
            // block-level nodes: it preserves order (manual insert() in a
            // loop would reverse them because the insert pos never moves
            // forward), and PM handles the block-boundary splitting.
            const fragment = Fragment.from(pmNodes);
            const slice = new Slice(fragment, 0, 0);
            const tr = state.tr.replaceSelection(slice).scrollIntoView();
            view.dispatch(tr);
          } catch (err) {
            console.warn('[smart-paste] PM insert failed:', err);
          }
        }).catch(err => {
          console.warn('[smart-paste] markdownToPMNodes failed:', err);
        });

        return true; // we're handling it
      },
    },
  });
}

/**
 * Heuristic to decide when to invoke the markdown pipeline.
 *
 * If the text is multi-line, or contains any common markdown marker
 * (heading, fenced code, list bullet, table pipe, math delimiter,
 * image/link syntax), treat as markdown.  Otherwise let ProseMirror
 * do its normal caret-insertion so short word/phrase pastes aren't
 * surprising.
 */
function looksLikeMarkdown(text: string): boolean {
  if (/\n/.test(text)) return true;
  return /(^|\s)(#{1,3}\s|[-*]\s|\d+\.\s|>\s|```|\$\$|!\[|\[[^\]]+\]\()/m.test(text);
}

/**
 * Decide whether an HTML payload is worth parsing to Markdown. Plain
 * text wrapped in a single <span> isn't, Wiki's <p>+<a>+<b> layout is.
 */
function looksLikeRichHtml(html: string): boolean {
  return /<\s*(h[1-6]|ul|ol|li|pre|code|blockquote|table|img|a\s|strong|b\s|b>|em\s|em>|i\s|i>)/i.test(html);
}
