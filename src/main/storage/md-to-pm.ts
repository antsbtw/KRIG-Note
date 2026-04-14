/**
 * Markdown → ProseMirror JSON 转换器
 *
 * 简单的行级解析，不依赖外部 Markdown 库。
 * 支持：heading、paragraph、code block、blockquote、
 *       bullet list、ordered list、task list、horizontal rule、
 *       image (`![alt](src)` 独占一行)、math block (`$$...$$`)、
 *       inline: bold / italic / code / link / math (`$...$`)
 *
 * 图像 base64 data URL 会被自动 putBase64 到 mediaSurrealStore，
 * 节点的 src 会被替换为 `media://...`。异步。
 */

import { mediaSurrealStore } from '../media/media-surreal-store';

interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

export async function markdownToProseMirror(md: string): Promise<PMNode[]> {
  const lines = md.split('\n');
  const content: PMNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 空行 → 跳过
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Code block (```)
    if (line.trimStart().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      const textContent = codeLines.join('\n');
      content.push({
        type: 'codeBlock',
        attrs: lang ? { language: lang } : undefined,
        content: textContent ? [{ type: 'text', text: textContent }] : undefined,
      });
      continue;
    }

    // Math block: $$...$$ (single line) or $$ ... $$ (multi-line)
    if (line.trim().startsWith('$$')) {
      const first = line.trim().slice(2);
      const closeIdx = first.indexOf('$$');
      if (closeIdx >= 0) {
        const latex = first.slice(0, closeIdx).trim();
        if (latex) content.push({ type: 'mathBlock', attrs: { latex } });
        i++;
        continue;
      }
      const buf: string[] = [];
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
      if (latex) content.push({ type: 'mathBlock', attrs: { latex } });
      continue;
    }

    // Block-level image
    const imgMatch = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (imgMatch) {
      const alt = imgMatch[1] || '';
      const rawSrc = imgMatch[2];
      const src = await resolvePMImageSrc(rawSrc);
      content.push({
        type: 'image',
        attrs: { src, alt },
        content: [{ type: 'textBlock', content: [] }], // empty caption textBlock
      });
      i++;
      continue;
    }

    // Block-level attachment: `!attach[filename](src)`
    const attachMatch = line.trim().match(/^!attach\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (attachMatch) {
      const filename = attachMatch[1] || 'attachment';
      const rawSrc = attachMatch[2];
      const resolved = await resolvePMAttachmentSrc(rawSrc, filename);
      content.push({
        type: 'fileBlock',
        attrs: {
          mediaId:  resolved.mediaId,
          src:      resolved.src,
          filename: resolved.filename,
          mimeType: resolved.mimeType,
          size:     null,
          source:   null,
        },
        // text* content — empty; see fileBlock nodeSpec comment.
      });
      i++;
      continue;
    }

    // Block-level external file reference: `!file[title](/path)`
    const fileMatch = line.trim().match(/^!file\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (fileMatch) {
      const title = fileMatch[1] || '';
      const rawPath = fileMatch[2];
      content.push({
        type: 'externalRef',
        attrs: {
          kind: 'file',
          href: normalizePMFileHref(rawPath),
          title,
          mimeType: '',
          size: null,
          modifiedAt: null,
        },
        // text* content — empty.
      });
      i++;
      continue;
    }

    // Heading (# ## ###)
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      content.push({
        type: 'textBlock',
        attrs: { level },
        content: parseInline(headingMatch[2]),
      });
      i++;
      continue;
    }

    // Horizontal rule (--- or ***)
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      content.push({ type: 'horizontalRule' });
      i++;
      continue;
    }

    // Blockquote (>)
    if (line.trimStart().startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith('> ')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      const innerContent = await markdownToProseMirror(quoteLines.join('\n'));
      content.push({
        type: 'blockquote',
        content: innerContent.length > 0 ? innerContent : [{ type: 'textBlock' }],
      });
      continue;
    }

    // Task list (- [ ] or - [x])
    if (/^\s*[-*]\s+\[([ x])\]\s/.test(line)) {
      const items: PMNode[] = [];
      while (i < lines.length && /^\s*[-*]\s+\[([ x])\]\s/.test(lines[i])) {
        const match = lines[i].match(/^\s*[-*]\s+\[([ x])\]\s(.*)/)!;
        items.push({
          type: 'taskItem',
          attrs: { checked: match[1] === 'x' },
          content: [{ type: 'textBlock', content: parseInline(match[2]) }],
        });
        i++;
      }
      content.push({ type: 'taskList', content: items });
      continue;
    }

    // Bullet list (- or *)
    // KRIG-Note schema: bulletList content='block+'，无 listItem 中间层
    if (/^\s*[-*]\s+/.test(line) && !/^\s*[-*]\s+\[/.test(line)) {
      const items: PMNode[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]) && !/^\s*[-*]\s+\[/.test(lines[i])) {
        const text = lines[i].replace(/^\s*[-*]\s+/, '');
        items.push({ type: 'textBlock', content: parseInline(text) });
        i++;
      }
      content.push({ type: 'bulletList', content: items });
      continue;
    }

    // Ordered list (1. 2. etc)
    // KRIG-Note schema: orderedList content='block+'，无 listItem 中间层
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: PMNode[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const text = lines[i].replace(/^\s*\d+\.\s+/, '');
        items.push({ type: 'textBlock', content: parseInline(text) });
        i++;
      }
      content.push({ type: 'orderedList', content: items });
      continue;
    }

    // Table (| ... |)
    if (line.trimStart().startsWith('|')) {
      const tableRows: PMNode[] = [];
      let isFirst = true;
      while (i < lines.length && lines[i].trimStart().startsWith('|')) {
        const row = lines[i].trim();
        // Skip separator row (|---|---|)
        if (/^\|[\s\-:]+\|/.test(row) && row.includes('---')) {
          i++;
          continue;
        }
        const cells = row.split('|').filter((_, idx, arr) => idx > 0 && idx < arr.length - 1).map(c => c.trim());
        const cellType = isFirst ? 'tableHeader' : 'tableCell';
        const rowNode: PMNode = {
          type: 'tableRow',
          content: cells.map(cell => ({
            type: cellType,
            content: [{ type: 'textBlock', content: parseInline(cell) }],
          })),
        };
        tableRows.push(rowNode);
        isFirst = false;
        i++;
      }
      if (tableRows.length > 0) {
        content.push({ type: 'table', content: tableRows });
      }
      continue;
    }

    // Paragraph (default)
    content.push({
      type: 'textBlock',
      content: parseInline(line),
    });
    i++;
  }

  return content;
}

/** Mirror of md-to-atoms.resolveAttachmentSrc for PM flow. */
async function resolvePMAttachmentSrc(
  rawSrc: string,
  filename: string,
): Promise<{ src: string; mediaId: string; filename: string; mimeType: string }> {
  if (rawSrc.startsWith('data:') && rawSrc.includes(';base64,')) {
    try {
      const mimeMatch = rawSrc.match(/^data:([^;]+);/);
      const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
      const r = await mediaSurrealStore.putBase64(rawSrc, mime, filename);
      if (r.success && r.mediaUrl) {
        return { src: r.mediaUrl, mediaId: r.mediaId || '', filename, mimeType: mime };
      }
    } catch { /* fall through */ }
  }
  return { src: rawSrc, mediaId: '', filename, mimeType: '' };
}

/** Mirror of md-to-atoms.normalizeFileHref for PM flow. */
function normalizePMFileHref(raw: string): string {
  if (raw.startsWith('file:')) return raw;
  if (raw.startsWith('/')) {
    const encoded = raw.split('/').map(seg => seg ? encodeURIComponent(seg) : '').join('/');
    return `file://${encoded}`;
  }
  return raw;
}

/**
 * Resolve an image src for ProseMirror: data URLs get persisted to
 * mediaSurrealStore and rewritten to `media://...`; other schemes pass
 * through.
 */
async function resolvePMImageSrc(rawSrc: string): Promise<string> {
  if (rawSrc.startsWith('data:') && rawSrc.includes(';base64,')) {
    try {
      const r = await mediaSurrealStore.putBase64(rawSrc);
      if (r.success && r.mediaUrl) return r.mediaUrl;
    } catch {
      /* fall through */
    }
  }
  return rawSrc;
}

/** 解析 inline 格式：bold、italic、code、link、math ($...$) */
function parseInline(text: string): PMNode[] {
  if (!text || !text.trim()) return [];

  const nodes: PMNode[] = [];
  // 支持: **bold**, *italic*, `code`, [text](url), $math$
  // See md-to-atoms.ts parseInline for the $-heuristic reasoning.
  const regex = /(\*\*([\s\S]+?)\*\*|\*([^\*\n]+?)\*|`([^`\n]+?)`|\[([^\]]+)\]\(([^)]+)\)|\$([^\s$][^$\n]*?[^\s$]|[^\s$])\$)/g;

  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }

    if (match[2] !== undefined) {
      nodes.push({ type: 'text', text: match[2], marks: [{ type: 'bold' }] });
    } else if (match[3] !== undefined) {
      nodes.push({ type: 'text', text: match[3], marks: [{ type: 'italic' }] });
    } else if (match[4] !== undefined) {
      nodes.push({ type: 'text', text: match[4], marks: [{ type: 'code' }] });
    } else if (match[5] && match[6]) {
      nodes.push({ type: 'text', text: match[5], marks: [{ type: 'link', attrs: { href: match[6] } }] });
    } else if (match[7] !== undefined) {
      nodes.push({ type: 'mathInline', attrs: { latex: match[7] } });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push({ type: 'text', text: text.slice(lastIndex) });
  }

  return nodes.length > 0 ? nodes : [{ type: 'text', text }];
}

/** 从 Markdown 文件内容构建完整的 doc_content */
export async function mdToDocContent(md: string, title: string): Promise<unknown[]> {
  const blocks = await markdownToProseMirror(md);
  return [
    { type: 'textBlock', attrs: { isTitle: true }, content: [{ type: 'text', text: title }] },
    ...blocks,
  ];
}
