/**
 * Markdown → Atom[] 转换器
 *
 * 简单的行级解析，不依赖外部 Markdown 库。
 * 输出 Atom[] 格式（不是 ProseMirror JSON）。
 *
 * 支持：heading、paragraph、code block、blockquote、
 *       bullet list、ordered list、task list、horizontal rule、
 *       table、inline marks（bold、italic、code、link）
 */

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
} from '../../shared/types/atom-types';

/**
 * 从 Markdown 生成完整的 doc_content（Atom[]）
 */
export function mdToAtoms(md: string, title: string): Atom[] {
  const atoms: Atom[] = [];

  // noteTitle
  atoms.push(createAtom('noteTitle', {
    children: [{ type: 'text', text: title }],
  } as NoteTitleContent));

  // 解析 Markdown body
  const bodyAtoms = parseMarkdownToAtoms(md);
  atoms.push(...bodyAtoms);

  // 设置 order
  atoms.forEach((a, i) => { a.order = i; });

  return atoms;
}

function parseMarkdownToAtoms(md: string): Atom[] {
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
      const innerAtoms = parseMarkdownToAtoms(quoteLines.join('\n'));
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

/** 解析 inline 格式 → InlineElement[] */
function parseInline(text: string): InlineElement[] {
  if (!text?.trim()) return [];

  const elements: InlineElement[] = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      elements.push({ type: 'text', text: text.slice(lastIndex, match.index) } as TextNode);
    }
    if (match[2]) {
      elements.push({ type: 'text', text: match[2], marks: [{ type: 'bold' }] } as TextNode);
    } else if (match[3]) {
      elements.push({ type: 'text', text: match[3], marks: [{ type: 'italic' }] } as TextNode);
    } else if (match[4]) {
      elements.push({ type: 'text', text: match[4], marks: [{ type: 'code' }] } as TextNode);
    } else if (match[5] && match[6]) {
      elements.push({
        type: 'link',
        href: match[6],
        children: [{ type: 'text', text: match[5] }],
      } as any);
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    elements.push({ type: 'text', text: text.slice(lastIndex) } as TextNode);
  }

  return elements.length > 0 ? elements : [{ type: 'text', text } as TextNode];
}
