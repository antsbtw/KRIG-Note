/**
 * smart-paste — treat clipboard text as Markdown.
 *
 * AI assistants (Claude, ChatGPT, Gemini) and many code-oriented sites
 * put standard Markdown in the `text/plain` flavor of their clipboard
 * payloads. If we let ProseMirror's default paste handler drop the text
 * in, `$$...$$` / `![](...)` / fenced code etc. stay as literal text
 * — KaTeX and image blocks never fire because input rules only run on
 * live typing, not on bulk paste.
 *
 * This plugin runs clipboard text through the existing markdown →
 * ProseMirror pipeline (md-to-pm.ts on the main side), then replaces
 * the selection with the resulting block fragment. That way a paste
 * produces the same tree you'd get from opening a `.md` file.
 *
 * Interaction with other paste plugins:
 *   - paste-media runs first and handles `image/*` items, so a
 *     clipboard containing image bytes still inserts as an image.
 *   - smart-paste skips paste if the clipboard only has image data.
 *   - smart-paste skips "trivial" text that looks like a plain string
 *     (no newlines, no markdown markers) — default caret-insertion
 *     stays intact for everyday typing-like pastes.
 */

import { Plugin } from 'prosemirror-state';
import { Slice, Fragment } from 'prosemirror-model';

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

        const markdown = cd.getData('text/plain');
        if (!markdown || !markdown.trim()) return false;

        // Heuristic: single short line with no markdown markers — let
        // ProseMirror do its default caret-insertion. Multi-line or
        // markdown-flavored text goes through the full pipeline.
        if (!looksLikeMarkdown(markdown)) return false;

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
