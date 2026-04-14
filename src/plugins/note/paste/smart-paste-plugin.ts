/**
 * smart-paste-plugin — clipboard → KRIG blocks dispatcher.
 *
 * ─────────────────────────────────────────────────────────────
 * Shortcut conventions
 * ─────────────────────────────────────────────────────────────
 *
 *   Cmd+V (default)    → "paste as markdown": dispatcher picks a
 *                        source handler, gets back a Markdown string,
 *                        feeds it through md-to-pm. AI assistants,
 *                        Word tables, and generic rich HTML all land
 *                        as proper blocks.
 *
 *   Cmd+Shift+V        → "paste as plain text": every character goes
 *                        in verbatim, \n becomes hardBreak, blank
 *                        lines become paragraph splits. No Markdown
 *                        interpretation, no handler dispatch. Escape
 *                        hatch for when markdown interpretation would
 *                        misread the content (raw text logs, poetry,
 *                        anything where `$` / `#` / `-` characters
 *                        are meaningful but not markdown).
 *
 * ─────────────────────────────────────────────────────────────
 * Dispatcher contract
 * ─────────────────────────────────────────────────────────────
 *
 * Each `PasteHandler` inspects the clipboard and may claim ownership
 * via `detect()`. The first handler to claim is called; if its
 * `toMarkdown()` returns an empty string the dispatcher treats that
 * as a soft skip and tries the next handler. `genericHandler` is the
 * always-match catch-all at the end, so the dispatcher never falls
 * off the end of the list.
 *
 * Source-specific handlers (Word, Notion, Excel, Wiki, …) live in
 * `sources/*.ts`. Add new ones by importing and unshifting to the
 * `HANDLERS` list so they're tried before the generic fallback.
 * See `docs/note/Paste-Module-Design.md` for the roadmap and
 * per-source design notes.
 *
 * ─────────────────────────────────────────────────────────────
 * Interaction with paste-media
 * ─────────────────────────────────────────────────────────────
 *
 * paste-media (in src/plugins/note/plugins/) runs before this plugin
 * and handles clipboard image bytes. When the clipboard has BOTH an
 * image and structural HTML (Word/Excel bundle a PNG render as a
 * fallback), paste-media defers to this dispatcher so the real table
 * wins. Pure screenshots (image only) keep inserting as image blocks.
 */

import { Plugin } from 'prosemirror-state';
import { Slice, Fragment } from 'prosemirror-model';
import type { PasteClipboard, PasteHandler } from './types';
import { genericHandler } from './sources/generic';

/** Registered handlers, in priority order. Specific → generic. */
const HANDLERS: PasteHandler[] = [
  // Future: wordHandler, notionHandler, excelHandler, wikiHandler, …
  genericHandler,
];

interface ViewAPILike {
  markdownToPMNodes?: (markdown: string) => Promise<unknown[]>;
}

// Global shift tracker — ClipboardEvent doesn't carry modifier keys.
let shiftDown = false;
let trackerInstalled = false;
function installShiftTracker() {
  if (trackerInstalled) return;
  trackerInstalled = true;
  window.addEventListener('keydown', (e) => { if (e.key === 'Shift') shiftDown = true; });
  window.addEventListener('keyup', (e) => { if (e.key === 'Shift') shiftDown = false; });
  window.addEventListener('blur', () => { shiftDown = false; });
}

export function smartPastePlugin(): Plugin {
  installShiftTracker();
  return new Plugin({
    props: {
      handlePaste(view, event) {
        const cd = event.clipboardData;
        if (!cd) return false;

        const clipboard: PasteClipboard = {
          plain: cd.getData('text/plain') || '',
          html: cd.getData('text/html') || '',
          hasImage: Array.from(cd.items).some(it => it.kind === 'file' && it.type.startsWith('image/')),
        };

        // Let paste-media handle pure-image payloads. (Word/Excel sends
        // a PNG alongside HTML; paste-media itself already defers to
        // us in that case — see paste-media.ts.)
        if (clipboard.hasImage && !clipboard.html && !clipboard.plain) return false;

        // Shift branch: straight plain text insert, no handlers.
        if (shiftDown) {
          if (!clipboard.plain.trim()) return false;
          insertAsPlainText(view, clipboard.plain);
          return true;
        }

        // Dispatcher: try each handler in priority order.
        let markdown = '';
        for (const h of HANDLERS) {
          if (!h.detect(clipboard)) continue;
          const r = h.toMarkdown(clipboard);
          if (r.markdown) { markdown = r.markdown; break; }
        }
        if (!markdown.trim()) return false;

        const api: ViewAPILike | undefined = (window as any).viewAPI;
        if (!api?.markdownToPMNodes) return false;

        api.markdownToPMNodes(markdown).then(nodes => {
          if (!Array.isArray(nodes) || nodes.length === 0) return;
          try {
            const { state } = view;
            const { schema } = state;
            const pmNodes = nodes
              .map(n => {
                try { return schema.nodeFromJSON(n as any); }
                catch { return null; }
              })
              .filter((n): n is NonNullable<typeof n> => !!n);
            if (pmNodes.length === 0) return;

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

        return true;
      },
    },
  });
}

/**
 * Plain-text paste (Cmd+Shift+V branch).
 *
 * Splits on blank lines into paragraph-per-chunk; single `\n` becomes
 * a `hardBreak` inside the current paragraph. No marks, no link
 * parsing, no markdown interpretation.
 */
function insertAsPlainText(view: any, text: string) {
  const { state } = view;
  const { schema } = state;
  const paragraphType = schema.nodes.textBlock || schema.nodes.paragraph;
  if (!paragraphType) {
    view.dispatch(state.tr.insertText(text, state.selection.from, state.selection.to));
    return;
  }

  const paragraphs = text.split(/\n{2,}/);
  const nodes: any[] = [];
  for (const para of paragraphs) {
    const lines = para.split('\n');
    const parts: any[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].length > 0) parts.push(schema.text(lines[i]));
      if (i < lines.length - 1 && schema.nodes.hardBreak) {
        parts.push(schema.nodes.hardBreak.create());
      }
    }
    try {
      nodes.push(paragraphType.create(null, parts));
    } catch {
      nodes.push(paragraphType.create(null, schema.text(para.replace(/\n/g, ' '))));
    }
  }
  if (nodes.length === 0) return;

  const fragment = Fragment.from(nodes);
  const slice = new Slice(fragment, 0, 0);
  const tr = state.tr.replaceSelection(slice).scrollIntoView();
  view.dispatch(tr);
}
