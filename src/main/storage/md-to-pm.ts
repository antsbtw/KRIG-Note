/**
 * Markdown → ProseMirror JSON 转换器
 *
 * 简单的行级解析，不依赖外部 Markdown 库。
 * 支持：heading、paragraph、code block、blockquote、
 *       bullet list、ordered list、task list、horizontal rule、
 *       inline marks（bold、italic、code、link）
 */

interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

export function markdownToProseMirror(md: string): PMNode[] {
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

    // Heading (# ## ###)
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      content.push({
        type: 'heading',
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
      const innerContent = markdownToProseMirror(quoteLines.join('\n'));
      content.push({
        type: 'blockquote',
        content: innerContent.length > 0 ? innerContent : [{ type: 'paragraph' }],
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
          content: [{ type: 'paragraph', content: parseInline(match[2]) }],
        });
        i++;
      }
      content.push({ type: 'taskList', content: items });
      continue;
    }

    // Bullet list (- or *)
    if (/^\s*[-*]\s+/.test(line) && !/^\s*[-*]\s+\[/.test(line)) {
      const items: PMNode[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]) && !/^\s*[-*]\s+\[/.test(lines[i])) {
        const text = lines[i].replace(/^\s*[-*]\s+/, '');
        items.push({
          type: 'listItem',
          content: [{ type: 'paragraph', content: parseInline(text) }],
        });
        i++;
      }
      content.push({ type: 'bulletList', content: items });
      continue;
    }

    // Ordered list (1. 2. etc)
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: PMNode[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const text = lines[i].replace(/^\s*\d+\.\s+/, '');
        items.push({
          type: 'listItem',
          content: [{ type: 'paragraph', content: parseInline(text) }],
        });
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
            content: [{ type: 'paragraph', content: parseInline(cell) }],
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
      type: 'paragraph',
      content: parseInline(line),
    });
    i++;
  }

  return content;
}

/** 解析 inline 格式：bold、italic、code、link */
function parseInline(text: string): PMNode[] {
  if (!text || !text.trim()) return [];

  const nodes: PMNode[] = [];
  // 简化处理：用正则逐段匹配
  // 支持: **bold**, *italic*, `code`, [text](url)
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[([^\]]+)\]\(([^)]+)\))/g;

  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // 前面的普通文字
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }

    if (match[2]) {
      // **bold**
      nodes.push({ type: 'text', text: match[2], marks: [{ type: 'bold' }] });
    } else if (match[3]) {
      // *italic*
      nodes.push({ type: 'text', text: match[3], marks: [{ type: 'italic' }] });
    } else if (match[4]) {
      // `code`
      nodes.push({ type: 'text', text: match[4], marks: [{ type: 'code' }] });
    } else if (match[5] && match[6]) {
      // [text](url)
      nodes.push({ type: 'text', text: match[5], marks: [{ type: 'link', attrs: { href: match[6] } }] });
    }

    lastIndex = match.index + match[0].length;
  }

  // 剩余文字
  if (lastIndex < text.length) {
    nodes.push({ type: 'text', text: text.slice(lastIndex) });
  }

  return nodes.length > 0 ? nodes : [{ type: 'text', text }];
}

/** 从 Markdown 文件内容构建完整的 doc_content */
export function mdToDocContent(md: string, title: string): unknown[] {
  const blocks = markdownToProseMirror(md);
  return [
    { type: 'noteTitle', content: [{ type: 'text', text: title }] },
    ...blocks,
  ];
}
