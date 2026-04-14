/**
 * Markdown → Atom[] 转换器
 *
 * 简单的行级解析，不依赖外部 Markdown 库。
 * 输出 Atom[] 格式（不是 ProseMirror JSON）。
 *
 * 支持：heading、paragraph、code block、blockquote、
 *       bullet list、ordered list、task list、horizontal rule、
 *       table、image (``![alt](src)`` 独占一行)、
 *       math block (`$$...$$` 独占一行或跨行)、
 *       inline: bold / italic / code / link / math ($...$)
 *
 * 图像语法规则（重要）：
 *   - `![alt](http(s)://...)`          → image atom，src 原样保留
 *   - `![alt](media://...)`            → image atom，src 原样保留
 *   - `![alt](data:image/...;base64)`  → 自动调用 mediaSurrealStore.putBase64
 *                                        写入 media 表 + 磁盘，atom 存 `media://...`
 *     这是把 AI 生成的 base64 图像落地到 KRIG 持久存储的唯一路径。
 *
 * 因为写 media 是异步的，整个转换器是 async 的。
 */

import { mediaSurrealStore } from '../media/media-surreal-store';
import {
  createAtom,
  type Atom,
  type InlineElement,
  type TextNode,
  type Mark,
  type NoteTitleContent,
  type ParagraphContent,
  type HeadingContent,
  type CodeBlockContent,
  type BlockquoteContent,
  type ListContent,
  type ListItemContent,
  type TableContent,
  type TableCellContent,
  type ImageContent,
  type MathBlockContent,
  type MathInline,
  type FileBlockContent,
  type ExternalRefContent,
} from '../../shared/types/atom-types';

/**
 * 从 Markdown 生成完整的 doc_content（Atom[]）
 */
export async function mdToAtoms(md: string, title: string): Promise<Atom[]> {
  const atoms: Atom[] = [];

  // noteTitle
  atoms.push(createAtom('noteTitle', {
    children: [{ type: 'text', text: title }],
  } as NoteTitleContent));

  // 解析 Markdown body
  const bodyAtoms = await parseMarkdownToAtoms(md);
  atoms.push(...bodyAtoms);

  // 设置 order
  atoms.forEach((a, i) => { a.order = i; });

  return atoms;
}

async function parseMarkdownToAtoms(md: string): Promise<Atom[]> {
  const lines = md.split('\n');
  const atoms: Atom[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') { i++; continue; }

    // Code block
    if (line.trimStart().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      atoms.push(createAtom('codeBlock', {
        code: codeLines.join('\n'),
        language: lang || '',
      } as CodeBlockContent));
      continue;
    }

    // Math block: $$...$$ on its own (may span multiple lines).
    // Recognized when the line starts with `$$` after trimming.
    if (line.trim().startsWith('$$')) {
      const buf: string[] = [];
      // Strip the opening `$$` from the first line
      let first = line.trim().slice(2);
      // Single-line case: `$$...$$`
      const closeIdx = first.indexOf('$$');
      if (closeIdx >= 0) {
        const latex = first.slice(0, closeIdx).trim();
        if (latex) atoms.push(createAtom('mathBlock', { latex } as MathBlockContent));
        i++;
        continue;
      }
      if (first) buf.push(first);
      i++;
      while (i < lines.length) {
        const curr = lines[i];
        const end = curr.indexOf('$$');
        if (end >= 0) {
          const head = curr.slice(0, end).trimEnd();
          if (head) buf.push(head);
          i++;
          break;
        }
        buf.push(curr);
        i++;
      }
      const latex = buf.join('\n').trim();
      if (latex) atoms.push(createAtom('mathBlock', { latex } as MathBlockContent));
      continue;
    }

    // Block-level image: `![alt](src)` on its own line.
    // Inline `![](...)` within a paragraph is not supported (image is a
    // block-level node in the KRIG editor).
    const imgMatch = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (imgMatch) {
      const alt = imgMatch[1] || '';
      const rawSrc = imgMatch[2];
      const imageContent = await resolveImageSrc(rawSrc, alt);
      atoms.push(createAtom('image', imageContent));
      i++;
      continue;
    }

    // Block-level attachment: `!attach[filename](src)` on its own line.
    // When src is a data URL the bytes are persisted to the media store
    // and the atom stores a `media://files/...` URL. Otherwise src is
    // passed through unchanged (assumed to be a pre-existing media:// URL).
    const attachMatch = line.trim().match(/^!attach\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (attachMatch) {
      const filename = attachMatch[1] || 'attachment';
      const rawSrc = attachMatch[2];
      const content = await resolveAttachmentSrc(rawSrc, filename);
      atoms.push(createAtom('fileBlock', content));
      i++;
      continue;
    }

    // Block-level external file reference: `!file[title](/path|file:///...)`
    // on its own line. Never copies bytes — just stores the URI.
    const fileMatch = line.trim().match(/^!file\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (fileMatch) {
      const title = fileMatch[1] || '';
      const rawPath = fileMatch[2];
      atoms.push(createAtom('externalRef', {
        kind: 'file',
        href: normalizeFileHref(rawPath),
        title: title || undefined,
      } as ExternalRefContent));
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      atoms.push(createAtom('heading', {
        level: headingMatch[1].length as 1 | 2 | 3,
        children: parseInline(headingMatch[2]),
      } as HeadingContent));
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      atoms.push(createAtom('horizontalRule', {} as any));
      i++;
      continue;
    }

    // Blockquote
    if (line.trimStart().startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith('> ')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      const bqAtom = createAtom('blockquote', {
        children: parseInline(quoteLines.join(' ')),
      } as BlockquoteContent);
      atoms.push(bqAtom);

      // 引用块内的内容作为子 Atom
      const innerAtoms = await parseMarkdownToAtoms(quoteLines.join('\n'));
      for (const inner of innerAtoms) {
        inner.parentId = bqAtom.id;
        atoms.push(inner);
      }
      continue;
    }

    // Task list
    if (/^\s*[-*]\s+\[([ x])\]\s/.test(line)) {
      const listAtom = createAtom('taskList', { listType: 'task' } as ListContent);
      atoms.push(listAtom);
      while (i < lines.length && /^\s*[-*]\s+\[([ x])\]\s/.test(lines[i])) {
        const match = lines[i].match(/^\s*[-*]\s+\[([ x])\]\s(.*)/)!;
        const itemAtom = createAtom('taskItem', {
          children: parseInline(match[2]),
          checked: match[1] === 'x',
        } as ListItemContent);
        itemAtom.parentId = listAtom.id;
        atoms.push(itemAtom);
        i++;
      }
      continue;
    }

    // Bullet list
    if (/^\s*[-*]\s+/.test(line) && !/^\s*[-*]\s+\[/.test(line)) {
      const listAtom = createAtom('bulletList', { listType: 'bullet' } as ListContent);
      atoms.push(listAtom);
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]) && !/^\s*[-*]\s+\[/.test(lines[i])) {
        const text = lines[i].replace(/^\s*[-*]\s+/, '');
        const itemAtom = createAtom('paragraph', {
          children: parseInline(text),
        } as ParagraphContent);
        itemAtom.parentId = listAtom.id;
        atoms.push(itemAtom);
        i++;
      }
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const listAtom = createAtom('orderedList', { listType: 'ordered' } as ListContent);
      atoms.push(listAtom);
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const text = lines[i].replace(/^\s*\d+\.\s+/, '');
        const itemAtom = createAtom('paragraph', {
          children: parseInline(text),
        } as ParagraphContent);
        itemAtom.parentId = listAtom.id;
        atoms.push(itemAtom);
        i++;
      }
      continue;
    }

    // Table
    if (line.trimStart().startsWith('|')) {
      const tableAtom = createAtom('table', { colCount: 0 } as TableContent);
      atoms.push(tableAtom);
      let isFirst = true;
      while (i < lines.length && lines[i].trimStart().startsWith('|')) {
        const row = lines[i].trim();
        if (/^\|[\s\-:]+\|/.test(row) && row.includes('---')) { i++; continue; }
        const cells = row.split('|').filter((_, idx, arr) => idx > 0 && idx < arr.length - 1).map(c => c.trim());
        if (isFirst) {
          (tableAtom.content as TableContent).colCount = cells.length;
        }

        const rowAtom = createAtom('tableRow', {} as any);
        rowAtom.parentId = tableAtom.id;
        atoms.push(rowAtom);

        for (const cell of cells) {
          const cellType = isFirst ? 'tableHeader' : 'tableCell';
          const cellAtom = createAtom(cellType, {
            children: parseInline(cell),
            isHeader: isFirst,
          } as TableCellContent);
          cellAtom.parentId = rowAtom.id;
          atoms.push(cellAtom);
        }

        isFirst = false;
        i++;
      }
      continue;
    }

    // Paragraph (default)
    atoms.push(createAtom('paragraph', {
      children: parseInline(line),
    } as ParagraphContent));
    i++;
  }

  return atoms;
}

/**
 * Resolve an attachment `src` string into a FileBlockContent.
 *
 * - `data:<mime>;base64,...`  → putBase64 → `media://files/...`
 * - `media://...`             → pass-through (already in store)
 * - otherwise                 → pass-through but mediaId remains empty
 *   (caller may wish to upgrade this to an externalRef instead)
 */
async function resolveAttachmentSrc(
  rawSrc: string,
  filename: string,
): Promise<FileBlockContent> {
  if (rawSrc.startsWith('data:') && rawSrc.includes(';base64,')) {
    try {
      const mimeMatch = rawSrc.match(/^data:([^;]+);/);
      const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
      const r = await mediaSurrealStore.putBase64(rawSrc, mime, filename);
      if (r.success && r.mediaUrl) {
        return {
          mediaId: r.mediaId || '',
          src: r.mediaUrl,
          filename,
          mimeType: mime,
        };
      }
    } catch {
      /* fall through */
    }
  }
  return { mediaId: '', src: rawSrc, filename, mimeType: '' };
}

/**
 * Normalize a raw path / URL into a `file:///...` URI. Accepts:
 *   - absolute path:  `/Users/wen/foo.pdf`
 *   - file: URL:      `file:///Users/wen/foo.pdf`
 *   - relative path (stored as-is — resolution deferred to caller)
 *
 * Always URI-encodes spaces and special characters when building the
 * `file://` form, so the stored href is always a valid URI.
 */
function normalizeFileHref(raw: string): string {
  if (raw.startsWith('file:')) return raw;
  if (raw.startsWith('/')) {
    // Split by '/', encode each segment — keeps the path structure,
    // escapes spaces/non-ASCII.
    const encoded = raw.split('/').map(seg => seg ? encodeURIComponent(seg) : '').join('/');
    return `file://${encoded}`;
  }
  return raw;
}

/**
 * Resolve an image `src` string into an ImageContent.
 *
 * - `data:<mime>;base64,...`       → persisted via mediaSurrealStore, src
 *   rewritten to the returned `media://...` URL, and `mediaId` recorded
 * - everything else (http(s), media://, file:, relative path)
 *                                  → passed through unchanged
 *
 * Failure of the media-store write falls back to keeping the original
 * data URL so the image still renders even if persistence failed — it
 * just won't survive a note reopen.
 */
async function resolveImageSrc(rawSrc: string, alt: string): Promise<ImageContent> {
  if (rawSrc.startsWith('data:') && rawSrc.includes(';base64,')) {
    try {
      const r = await mediaSurrealStore.putBase64(rawSrc);
      if (r.success && r.mediaUrl) {
        return { src: r.mediaUrl, alt, mediaId: r.mediaId };
      }
    } catch {
      /* fall through to storing the data URL as-is */
    }
  }
  return { src: rawSrc, alt };
}

/**
 * 解析 inline 格式 → InlineElement[]
 *
 * Recognized constructs (in order):
 *   **bold**, *italic*, `code`, [text](url), $math$
 *
 * `$...$` uses a heuristic regex that avoids the most common false-
 * positives (e.g. `$50`, `price $5`). Bare dollar amounts remain plain
 * text; adjacent letter or digit triggers the math match.
 */
function parseInline(text: string): InlineElement[] {
  if (!text?.trim()) return [];

  const elements: InlineElement[] = [];
  // Groups:
  //   1: whole match
  //   2: bold content         (**...**)
  //   3: italic content       (*...*)
  //   4: code content         (`...`)
  //   5/6: link text / href   ([x](y))
  //   7: inline math content  ($...$)  — no spaces immediately inside,
  //       no `$` or newline inside; length ≥ 1
  const regex = /(\*\*([\s\S]+?)\*\*|\*([^\*\n]+?)\*|`([^`\n]+?)`|\[([^\]]+)\]\(([^)]+)\)|\$([^\s$][^$\n]*?[^\s$]|[^\s$])\$)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      elements.push({ type: 'text', text: text.slice(lastIndex, match.index) } as TextNode);
    }
    if (match[2] !== undefined) {
      elements.push({ type: 'text', text: match[2], marks: [{ type: 'bold' }] } as TextNode);
    } else if (match[3] !== undefined) {
      elements.push({ type: 'text', text: match[3], marks: [{ type: 'italic' }] } as TextNode);
    } else if (match[4] !== undefined) {
      elements.push({ type: 'text', text: match[4], marks: [{ type: 'code' }] } as TextNode);
    } else if (match[5] && match[6]) {
      elements.push({
        type: 'link',
        href: match[6],
        children: [{ type: 'text', text: match[5] }],
      } as any);
    } else if (match[7] !== undefined) {
      elements.push({ type: 'math-inline', latex: match[7] } as MathInline);
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    elements.push({ type: 'text', text: text.slice(lastIndex) } as TextNode);
  }

  return elements.length > 0 ? elements : [{ type: 'text', text } as TextNode];
}
