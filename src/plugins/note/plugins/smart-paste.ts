/**
 * smart-paste — Shift-triggered "paste with formatting" for rich content.
 *
 * Design (like Google Docs / Notion):
 *
 *   Cmd+V  (default)      → plain text paste
 *                           Default ProseMirror behavior: insert the
 *                           clipboard's text/plain verbatim, preserving
 *                           line breaks as paragraph splits but NOT
 *                           interpreting markdown markers. Links are
 *                           lost as plain text, but pastes are
 *                           predictable and never surprise the user.
 *
 *   Cmd+Shift+V            → smart paste
 *                           This plugin kicks in. We pick the best
 *                           source in the clipboard:
 *                             - text/plain if it already looks like
 *                               Markdown (has newlines or markdown
 *                               markers)  → feed to md-to-pm
 *                             - else text/html if it has structural
 *                               tags  → html → markdown → md-to-pm
 *                             - else fall back to plain behavior
 *                           The result is a proper ProseMirror block
 *                           fragment (headings, code, math, images,
 *                           links, tables, …).
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
 * Shortcut reminder: on macOS Cmd+Shift+V is the browser convention
 * for "paste and match style" in Google Docs / Slack / most editors.
 * Familiar enough that no UI hint is needed.
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

        // ── Plain paste branch (Cmd+V) ────────────────────────────
        // ProseMirror's default paste handler will parse any text/html
        // present in the clipboard, which for rich sources like Wikipedia
        // produces a fragmented mess (each <a> becomes its own textBlock,
        // etc). We want Cmd+V to behave like "paste as plain text": drop
        // structure, keep paragraph breaks.
        if (!shiftDown) {
          const plain = cd.getData('text/plain');
          if (!plain) return false;
          insertAsPlainText(view, plain);
          return true;
        }

        // ── Smart paste branch (Cmd+Shift+V) ──────────────────────

        const plain = cd.getData('text/plain');
        const html = cd.getData('text/html');

        // Pick the best markdown source: prefer text/plain if it
        // already reads as markdown (AI assistants, code sites);
        // otherwise convert text/html → markdown (wiki, blog).
        let markdown = '';
        if (plain && looksLikeMarkdown(plain)) {
          markdown = plain;
        } else if (html && looksLikeRichHtml(html)) {
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

function looksLikeMarkdown(text: string): boolean {
  if (/\n/.test(text)) return true;
  return /(^|\s)(#{1,3}\s|[-*]\s|\d+\.\s|>\s|```|\$\$|!\[|\[[^\]]+\]\()/m.test(text);
}

function looksLikeRichHtml(html: string): boolean {
  return /<\s*(h[1-6]|ul|ol|li|pre|code|blockquote|table|img|a\s|strong|b\s|b>|em\s|em>|i\s|i>)/i.test(html);
}
