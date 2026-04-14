/**
 * smart-paste — clipboard text → KRIG blocks.
 *
 * Design (inverse of Google Docs / Slack, matching the user's request
 * that "markdown syntax is the default"):
 *
 *   Cmd+V (default)       → interpret clipboard's text/plain as Markdown.
 *                           AI assistants (Claude, ChatGPT, Gemini) and
 *                           most dev-oriented sites put canonical
 *                           Markdown in text/plain; feeding it through
 *                           md-to-pm produces the correct block tree
 *                           (math, code fences, lists, tables, …).
 *                           text/html is intentionally ignored — rich
 *                           HTML (Wikipedia, blogs) would otherwise
 *                           fragment one <a> per block and ruin the
 *                           layout.
 *
 *   Cmd+Shift+V           → plain text paste. Every character goes
 *                           in verbatim, split on blank lines into
 *                           paragraphs, \n becomes a hardBreak. Useful
 *                           escape hatch when markdown interpretation
 *                           would misread the content (e.g. pasting a
 *                           raw text log that happens to contain a # or
 *                           looks like a bullet).
 *
 * ─────────────────────────────────────────────────────────────
 * How Shift is detected
 * ─────────────────────────────────────────────────────────────
 * ClipboardEvent doesn't expose modifier keys. We install a global
 * keydown/keyup listener on `window` that tracks shiftDown. When a
 * paste fires, we read that flag. The listener is installed lazily
 * on first plugin construction and kept alive for the lifetime of
 * the editor (no cleanup needed — it's cheap and the editor lives
 * as long as the renderer).
 *
 * ─────────────────────────────────────────────────────────────
 * Interaction with other paste plugins
 * ─────────────────────────────────────────────────────────────
 *   - paste-media (image/* files) runs first and handles images
 *     regardless of Shift state.
 *   - We skip when an image is in the clipboard.
 *
 * text/html is deliberately unused. An earlier iteration fell back to
 * html-to-markdown for Wiki-style sources, but the results were worse
 * than plain text (every link became its own block). Users who want
 * to preserve links/bold from such sources should paste into an
 * external markdown converter first. The html-to-markdown module
 * still exists in utils/ for future flows (saved pages, AI scraped
 * HTML, etc.) but isn't wired here.
 */

import { Plugin } from 'prosemirror-state';
import { Slice, Fragment } from 'prosemirror-model';
import { htmlToMarkdown } from '../utils/html-to-markdown';

interface ViewAPILike {
  markdownToPMNodes?: (markdown: string) => Promise<unknown[]>;
}

// Global shift tracker. Installed once on first plugin instance.
let shiftDown = false;
let trackerInstalled = false;
function installShiftTracker() {
  if (trackerInstalled) return;
  trackerInstalled = true;
  window.addEventListener('keydown', (e) => { if (e.key === 'Shift') shiftDown = true; });
  window.addEventListener('keyup', (e) => { if (e.key === 'Shift') shiftDown = false; });
  // Reset on focus loss — if user alt-tabs while holding shift, the
  // keyup may never reach us.
  window.addEventListener('blur', () => { shiftDown = false; });
}

export function smartPastePlugin(): Plugin {
  installShiftTracker();
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

        // ── Shift branch (Cmd+Shift+V) — plain text only ──────────
        // Explicit opt-out of markdown interpretation. Users who want
        // "just drop the characters in" reach for the same shortcut
        // every other editor uses for the same purpose.
        if (shiftDown) {
          if (!plain || !plain.trim()) return false;
          insertAsPlainText(view, plain);
          return true;
        }

        // ── Default branch (Cmd+V) ────────────────────────────────
        // Source selection:
        //   - structural HTML (tables, headings) — e.g. Word / Excel /
        //     rich doc editors  → html → markdown. Preserves table
        //     structure that text/plain would flatten.
        //   - everything else  → text/plain fed to md-to-pm. AI
        //     assistants and markdown-native sources work; Wikipedia /
        //     blog pages land as plain paragraphs (links lost but no
        //     per-word fragmentation).
        // Link-heavy HTML without real structure is deliberately NOT
        // parsed — that was the Wikipedia scenario where every <a>
        // turned into its own block.
        let markdown = '';
        if (html && hasStructuralHtml(html)) {
          markdown = htmlToMarkdown(html);
        } else if (plain) {
          markdown = plain;
        }
        if (!markdown || !markdown.trim()) return false;

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

        return true; // we're handling it
      },
    },
  });
}

/**
 * Whether an HTML payload is worth converting to Markdown. The target
 * case is Word / Excel / any editor that produces real tables and
 * heading hierarchy. We deliberately NOT trigger on plain anchor-heavy
 * HTML (Wikipedia paragraphs) because those fragmented badly when run
 * through the converter — there a simple text/plain paste was better.
 */
function hasStructuralHtml(html: string): boolean {
  return /<\s*(table|thead|tbody|tr|th|td|h[1-6])\b/i.test(html);
}

/**
 * Insert clipboard text as plain paragraphs.
 *
 * Splits on blank lines (\n\n+) to form paragraphs; single \n becomes
 * a hard-break inside the current paragraph. No marks, no link parsing,
 * no markdown interpretation. Mirrors Google Docs / Slack "paste as
 * plain text" behavior.
 */
function insertAsPlainText(view: any, text: string) {
  const { state } = view;
  const { schema } = state;
  const paragraphType = schema.nodes.textBlock || schema.nodes.paragraph;
  if (!paragraphType) {
    // Schema missing expected block type; fall back to raw insertText.
    view.dispatch(state.tr.insertText(text, state.selection.from, state.selection.to));
    return;
  }

  const paragraphs = text.split(/\n{2,}/);
  const nodes: any[] = [];
  for (const para of paragraphs) {
    // Convert single \n → hard break (two spaces), then the paragraph
    // node holds a single run of text.
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
      // If parts are rejected (e.g. hardBreak not in textBlock's
      // allowed content), degrade to a single-line paragraph.
      nodes.push(paragraphType.create(null, schema.text(para.replace(/\n/g, ' '))));
    }
  }
  if (nodes.length === 0) return;

  const fragment = Fragment.from(nodes);
  const slice = new Slice(fragment, 0, 0);
  const tr = state.tr.replaceSelection(slice).scrollIntoView();
  view.dispatch(tr);
}

