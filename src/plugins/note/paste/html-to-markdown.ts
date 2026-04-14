/**
 * HTML → Markdown converter for clipboard paste.
 *
 * Used by the smart-paste plugin: when the user pastes content that has
 * a `text/html` flavor (most web pages, AI chat transcripts, docs), we
 * convert the HTML to Markdown here, then let md-to-pm / md-to-atoms
 * turn it into blocks. This preserves structure (headings, lists, code
 * blocks, images, tables, LaTeX) that `text/plain` would have flattened.
 *
 * Not full-fidelity. Scope is "well-formed HTML from common sources":
 *   - GitHub / Wikipedia / MDN
 *   - Claude / ChatGPT / Gemini answer bodies
 *   - MS Word paste (mso-* attrs stripped)
 *   - DevTools Copy Element
 *
 * For edge cases we fall back to textContent instead of throwing.
 *
 * Distinct from the `dom-to-markdown.ts` injection script used to scrape
 * AI pages — that one runs inside <webview> and is hand-crafted for the
 * AI assistants' DOM. This one is simpler and renderer-native.
 */

// ─────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────

/**
 * Convert an HTML string to a Markdown string suitable for the
 * md-to-atoms / md-to-pm pipeline.
 *
 * Returns the trimmed Markdown; the empty string is returned for empty
 * or unparseable input (caller should fall back to plain text).
 */
export function htmlToMarkdown(html: string): string {
  if (!html || !html.trim()) return '';
  try {
    // Parse via the browser's built-in HTML parser. Using a <template>
    // element avoids implicit <html>/<body> injection when feeding a
    // fragment.
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const md = processNode(tpl.content).trim();
    return md;
  } catch {
    return '';
  }
}

// ─────────────────────────────────────────────────────────────
// Walkers
// ─────────────────────────────────────────────────────────────

/** Block-level formatter: returns Markdown paragraphs separated by \n\n. */
function processNode(node: Node): string {
  const out: string[] = [];
  node.childNodes.forEach(child => {
    const piece = processBlock(child);
    if (piece) out.push(piece);
  });
  // Collapse 3+ blank lines down to 2 (one blank line between paragraphs
  // is idiomatic Markdown).
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * Convert a single node (element or text) to a Markdown block. Returns
 * empty string for nodes that don't produce block-level output on their
 * own (e.g. top-level whitespace).
 */
function processBlock(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = (node.textContent || '').replace(/\s+/g, ' ');
    return t.trim() ? t : '';
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  // Skip content we never want in the note.
  if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'head') return '';

  switch (tag) {
    case 'h1': case 'h2': case 'h3': {
      const level = Number(tag.slice(1));
      return `${'#'.repeat(level)} ${processInline(el).trim()}`;
    }
    case 'h4': case 'h5': case 'h6':
      // KRIG's textBlock only supports h1-h3; demote deeper headings.
      return `### ${processInline(el).trim()}`;

    case 'p':
    case 'div':
    case 'section':
    case 'article':
    case 'header':
    case 'footer':
    case 'main':
    case 'aside': {
      // Divs often wrap block content; recurse with block-level
      // semantics so nested lists/tables come through intact. If the
      // element contains only inline content, `processNode` returns a
      // single block of inline text anyway.
      const inner = processNode(el);
      return inner;
    }

    case 'br':
      return '  ';  // Markdown line break (two trailing spaces)

    case 'hr':
      return '---';

    case 'ul':
    case 'ol':
      return processList(el, tag === 'ol');

    case 'li':
      // When an <li> is encountered at the top level (shouldn't happen
      // normally), treat as a bullet item.
      return `- ${processInline(el).trim()}`;

    case 'blockquote': {
      const inner = processNode(el).trim();
      return inner.split('\n').map(line => `> ${line}`).join('\n');
    }

    case 'pre':
      return processPre(el);

    case 'code':
      // Top-level <code> (not wrapped in <pre>): treat as inline.
      return '`' + (el.textContent || '') + '`';

    case 'img':
      return processImg(el as HTMLImageElement);

    case 'a':
      return processInline(el);

    case 'table':
      return processTable(el as HTMLTableElement);

    case 'tbody':
    case 'thead':
    case 'tfoot':
    case 'tr':
    case 'td':
    case 'th':
      // Tables are handled via `processTable`; if we land here standalone
      // fall through to generic inline handling.
      return processInline(el);

    default:
      // Unknown container → recurse as block, or fall back to inline.
      if (hasBlockChildren(el)) return processNode(el);
      return processInline(el);
  }
}

function hasBlockChildren(el: HTMLElement): boolean {
  return Array.from(el.children).some(c => {
    const t = c.tagName.toLowerCase();
    return ['p', 'div', 'section', 'article', 'ul', 'ol', 'pre',
            'blockquote', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(t);
  });
}

// ─────────────────────────────────────────────────────────────
// Lists
// ─────────────────────────────────────────────────────────────

function processList(el: HTMLElement, ordered: boolean): string {
  const items: string[] = [];
  let n = 1;
  el.childNodes.forEach(child => {
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const li = child as HTMLElement;
    if (li.tagName.toLowerCase() !== 'li') return;
    const bullet = ordered ? `${n}. ` : '- ';
    n++;

    // Split li into its inline part and any nested block content
    // (nested ul/ol, nested code blocks).
    const inline: string[] = [];
    const nested: string[] = [];
    li.childNodes.forEach(inner => {
      if (inner.nodeType === Node.ELEMENT_NODE) {
        const t = (inner as HTMLElement).tagName.toLowerCase();
        if (t === 'ul' || t === 'ol' || t === 'pre') {
          nested.push(processBlock(inner));
          return;
        }
      }
      inline.push(processInline(inner));
    });
    const firstLine = bullet + inline.join('').trim();
    // Indent nested blocks by two spaces to keep them inside the item.
    const indented = nested
      .map(block => block.split('\n').map(l => '  ' + l).join('\n'))
      .join('\n');
    items.push(indented ? firstLine + '\n' + indented : firstLine);
  });
  return items.join('\n');
}

// ─────────────────────────────────────────────────────────────
// Code blocks
// ─────────────────────────────────────────────────────────────

function processPre(el: HTMLElement): string {
  // Language detection: try <code class="language-xxx"> or `hljs <lang>` or
  // a data-language attribute. None required.
  let lang = '';
  const code = el.querySelector('code');
  if (code) {
    const cls = code.className || '';
    const m = cls.match(/language-([\w-]+)/) || cls.match(/\blang-([\w-]+)/) || cls.match(/hljs\s+(\w+)/);
    if (m) lang = m[1];
    if (!lang && (code as HTMLElement).dataset && (code as HTMLElement).dataset.language) {
      lang = (code as HTMLElement).dataset.language!;
    }
  }
  // Use textContent to preserve whitespace; innerText would collapse
  // leading indentation.
  const text = (code ? code.textContent : el.textContent) || '';
  return '```' + lang + '\n' + text.replace(/\n$/, '') + '\n```';
}

// ─────────────────────────────────────────────────────────────
// Images
// ─────────────────────────────────────────────────────────────

function processImg(img: HTMLImageElement): string {
  const src = img.getAttribute('src') || '';
  if (!src) return '';
  const alt = img.getAttribute('alt') || '';
  return `![${alt}](${src})`;
}

// ─────────────────────────────────────────────────────────────
// Tables
// ─────────────────────────────────────────────────────────────

function processTable(table: HTMLTableElement): string {
  const rows: string[][] = [];
  let headerIdx = -1;
  const allRows = Array.from(table.querySelectorAll('tr'));
  allRows.forEach((tr, i) => {
    const cells: string[] = [];
    tr.querySelectorAll('td, th').forEach(cell => {
      cells.push(processInline(cell as HTMLElement).trim().replace(/\|/g, '\\|') || ' ');
    });
    if (cells.length === 0) return;
    rows.push(cells);
    // Treat the first row of <th>s as header
    if (headerIdx < 0 && tr.querySelector('th')) headerIdx = i;
  });
  if (rows.length === 0) return '';

  // Pad to uniform column count
  const cols = Math.max(...rows.map(r => r.length));
  rows.forEach(r => { while (r.length < cols) r.push(' '); });

  // Default header: first row (as Markdown tables require one)
  const header = rows.shift()!;
  const sep = header.map(() => '---');
  const lines: string[] = [];
  lines.push('| ' + header.join(' | ') + ' |');
  lines.push('| ' + sep.join(' | ') + ' |');
  rows.forEach(r => lines.push('| ' + r.join(' | ') + ' |'));
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// Inline
// ─────────────────────────────────────────────────────────────

/** Inline formatter: produces Markdown text without block separators. */
function processInline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent || '').replace(/\s+/g, ' ');
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  if (tag === 'script' || tag === 'style') return '';

  // KaTeX / MathJax math — both services embed a <annotation
  // encoding="application/x-tex">…</annotation> tag containing the
  // original LaTeX source. Preferring that gives us perfect fidelity.
  const math = extractMathFromRendered(el);
  if (math !== null) return math;

  switch (tag) {
    case 'br':
      return '  \n';
    case 'strong':
    case 'b':
      return `**${inlineChildren(el)}**`;
    case 'em':
    case 'i':
      return `*${inlineChildren(el)}*`;
    case 'code':
      return '`' + (el.textContent || '') + '`';
    case 'a': {
      const href = el.getAttribute('href') || '';
      const text = inlineChildren(el).trim() || href;
      if (!href) return text;
      return `[${text}](${href})`;
    }
    case 'img':
      return processImg(el as HTMLImageElement);
    default:
      return inlineChildren(el);
  }
}

function inlineChildren(el: HTMLElement): string {
  let out = '';
  el.childNodes.forEach(child => { out += processInline(child); });
  return out;
}

/**
 * Recover LaTeX source from a KaTeX / MathJax rendered element. Returns
 * the Markdown `$...$` / `$$...$$` form, or null if this element isn't a
 * math container (caller continues normal processing).
 *
 * Display mode detection: block math is usually wrapped in
 * `.katex-display` or has `display="block"` on the MathML tag.
 */
function extractMathFromRendered(el: HTMLElement): string | null {
  if (!el.classList) return null;
  const isKatex = el.classList.contains('katex') || el.classList.contains('katex-display');
  const isMathJax = el.classList.contains('MathJax') || el.tagName.toLowerCase() === 'mjx-container';
  if (!isKatex && !isMathJax) return null;

  const annotation = el.querySelector('annotation[encoding="application/x-tex"]');
  if (!annotation) return null;
  const tex = (annotation.textContent || '').trim();
  if (!tex) return null;

  const display = el.classList.contains('katex-display') ||
                  (el as any).getAttribute?.('display') === 'block' ||
                  !!el.closest('.katex-display');
  return display ? `$$${tex}$$` : `$${tex}$`;
}
