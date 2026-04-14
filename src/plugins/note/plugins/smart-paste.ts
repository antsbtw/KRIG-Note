/**
 * smart-paste — HTML → Markdown paste for rich web content.
 *
 * When the user pastes, we check clipboardData for a `text/html` flavor.
 * If present, convert HTML → Markdown → ProseMirror nodes (via
 * markdownToProseMirror) and insert. Works for any rich source: web
 * pages, AI chat answers, MS Word, etc. — not AI-specific.
 *
 * Plain-text pastes are left to ProseMirror's default handler.
 *
 * ─────────────────────────────────────────────────────────────
 * Interaction with other paste plugins
 * ─────────────────────────────────────────────────────────────
 *   - paste-media runs first (its plugin is registered before this one
 *     in NoteEditor's buildPlugins) and handles `image/*` items, so a
 *     clipboard containing both an image and HTML (Screenshot + alt
 *     text for example) still gets inserted as an image.
 *   - smart-paste ignores the event when `clipboardData.files` contains
 *     an image, to avoid racing with paste-media.
 *
 * ─────────────────────────────────────────────────────────────
 * Why parse HTML client-side instead of sending to main?
 * ─────────────────────────────────────────────────────────────
 * HTML → Markdown is a pure transformation; doing it in renderer keeps
 * the paste action synchronous (returns `true` immediately). The
 * resulting Markdown then flows through the *existing* async
 * markdownToProseMirror pipeline via IPC, which is fine — by the time
 * IPC returns the user has already seen the input handled.
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

        const html = cd.getData('text/html');
        if (!html || !html.trim()) return false;

        // Heuristic: very short HTML that just wraps a plain text
        // selection (single <span> / single fragment with no structural
        // tags) — let the default handler do its thing, avoids
        // surprising wrap transformations on a casual plain paste.
        if (!looksLikeRichHtml(html)) return false;

        const markdown = htmlToMarkdown(html);
        if (!markdown) return false;

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
 * Heuristic to skip "boring" HTML that's really just plain text with
 * default browser formatting. If there are structural tags
 * (headings, lists, code, tables, images), accept as rich HTML.
 */
function looksLikeRichHtml(html: string): boolean {
  const structural = /<\s*(h[1-6]|ul|ol|li|pre|code|blockquote|table|img|a\s)/i;
  return structural.test(html);
}
