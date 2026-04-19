import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode, Mark, Fragment } from 'prosemirror-model';

/**
 * selectionToMarkdown — 将 ProseMirror 选区内容无损序列化为 Markdown
 *
 * 支持三种选择粒度：
 * 1. 段落内部分文字（inline marks + mathInline）
 * 2. 单个 block（codeBlock, mathBlock, image, table 等）
 * 3. 跨 block 选择（多个 block 逐一序列化后拼接）
 *
 * 返回 { markdown, images }：
 * - markdown: 完整 Markdown 文本
 * - images: 选区内所有图片的 src 列表（供 multimodal AI 使用）
 */

export interface SelectionMarkdownResult {
  markdown: string;
  images: string[];
}

export function selectionToMarkdown(view: EditorView): SelectionMarkdownResult {
  const { state } = view;
  const { from, to, empty } = state.selection;
  if (empty) return { markdown: '', images: [] };

  const images: string[] = [];
  const lines: string[] = [];

  // 遍历选区内的顶层节点
  state.doc.nodesBetween(from, to, (node, pos, parent, index) => {
    // 只处理顶层 block 节点（或 doc 的直接子节点）
    // 对于嵌套结构，由各自的序列化函数递归处理
    if (node.isBlock && parent === state.doc) {
      const blockMd = serializeBlock(node, 0, images, from, to);
      if (blockMd !== null) {
        lines.push(blockMd);
        return false; // 不递归，serializeBlock 内部处理子节点
      }
    }
    return true;
  });

  // 如果没有收集到任何 block 级内容，说明选区完全在单个段落内部
  if (lines.length === 0) {
    const $from = state.selection.$from;
    const parent = $from.parent;
    if (parent.isTextblock) {
      // 提取选区范围内的 inline 内容
      const startOffset = from - $from.start($from.depth);
      const endOffset = to - $from.start($from.depth);
      const inlineMd = serializeInlineRange(parent, startOffset, endOffset);
      lines.push(inlineMd);
    }
  }

  return {
    markdown: lines.join('\n\n'),
    images,
  };
}

// ─── Block 序列化 ───────────────────────────────────────────────

function serializeBlock(
  node: PMNode,
  indent: number,
  images: string[],
  selFrom?: number,
  selTo?: number,
): string | null {
  const prefix = '  '.repeat(indent);

  switch (node.type.name) {
    case 'textBlock':
      return serializeTextBlock(node, prefix);

    case 'codeBlock':
      return serializeCodeBlock(node, prefix);

    case 'mathBlock':
      return serializeMathBlock(node, prefix);

    case 'image':
      return serializeImage(node, prefix, images);

    case 'horizontalRule':
      return `${prefix}---`;

    case 'blockquote':
      return serializeContainer(node, '> ', indent, images);

    case 'callout':
      return serializeCallout(node, indent, images);

    case 'bulletList':
      return serializeList(node, 'bullet', indent, images);

    case 'orderedList':
      return serializeList(node, 'ordered', indent, images);

    case 'taskList':
      return serializeTaskList(node, indent, images);

    case 'toggleList':
      return serializeToggleList(node, indent, images);

    case 'table':
      return serializeTable(node, prefix);

    case 'columnList':
      return serializeColumnList(node, indent, images);

    case 'videoBlock':
      return serializeMediaPlaceholder(node, prefix, 'Video');

    case 'audioBlock':
      return serializeMediaPlaceholder(node, prefix, 'Audio');

    case 'htmlBlock':
      return serializeMediaPlaceholder(node, prefix, 'HTML');

    case 'fileBlock':
      return `${prefix}[📎 ${node.attrs.filename || 'File'}]`;

    case 'externalRef':
      return `${prefix}[🔗 ${node.attrs.title || node.attrs.href || 'Link'}](${node.attrs.href || ''})`;

    case 'tweetBlock':
      return serializeTweet(node, prefix);

    case 'frameBlock':
      return serializeContainer(node, '', indent, images);

    case 'pageAnchor':
      return null; // 跳过书签

    default:
      // fallback: 纯文本
      const text = node.textContent;
      return text ? `${prefix}${text}` : null;
  }
}

// ─── TextBlock (paragraph / heading) ────────────────────────────

function serializeTextBlock(node: PMNode, prefix: string): string {
  const level = node.attrs.level as number | null;
  const headingPrefix = level ? '#'.repeat(level) + ' ' : '';
  const inline = serializeInlineContent(node);
  return `${prefix}${headingPrefix}${inline}`;
}

// ─── Inline 内容序列化 ─────────────────────────────────────────

function serializeInlineContent(node: PMNode): string {
  return serializeInlineRange(node, 0, node.content.size);
}

function serializeInlineRange(node: PMNode, startOffset: number, endOffset: number): string {
  const parts: string[] = [];

  node.forEach((child, offset) => {
    const childEnd = offset + child.nodeSize;
    // 跳过完全不在范围内的子节点
    if (childEnd <= startOffset || offset >= endOffset) return;

    if (child.isText) {
      let text = child.text || '';
      // 裁剪部分选中的文本
      const clipStart = Math.max(0, startOffset - offset);
      const clipEnd = Math.min(text.length, endOffset - offset);
      text = text.slice(clipStart, clipEnd);
      parts.push(wrapWithMarks(text, child.marks));
    } else if (child.type.name === 'mathInline') {
      parts.push(`$${child.attrs.latex || ''}$`);
    } else if (child.type.name === 'hardBreak') {
      parts.push('  \n');
    } else if (child.type.name === 'noteLink') {
      parts.push(`[[${child.attrs.label || child.attrs.noteId || ''}]]`);
    } else {
      // 未知 inline node — fallback to textContent
      parts.push(child.textContent);
    }
  });

  return parts.join('');
}

function wrapWithMarks(text: string, marks: readonly Mark[]): string {
  if (!text || marks.length === 0) return text;

  let result = text;
  for (const mark of marks) {
    switch (mark.type.name) {
      case 'bold':
        result = `**${result}**`;
        break;
      case 'italic':
        result = `*${result}*`;
        break;
      case 'code':
        result = `\`${result}\``;
        break;
      case 'strike':
        result = `~~${result}~~`;
        break;
      case 'underline':
        result = `<u>${result}</u>`;
        break;
      case 'link':
        result = `[${result}](${mark.attrs.href || ''})`;
        break;
      case 'highlight':
        result = `==${result}==`;
        break;
      // thought, textStyle — 不影响语义，跳过
    }
  }
  return result;
}

// ─── Code Block ─────────────────────────────────────────────────

function serializeCodeBlock(node: PMNode, prefix: string): string {
  const lang = node.attrs.language || '';
  const code = node.textContent;
  return `${prefix}\`\`\`${lang}\n${code}\n${prefix}\`\`\``;
}

// ─── Math Block ─────────────────────────────────────────────────

function serializeMathBlock(node: PMNode, prefix: string): string {
  const latex = node.textContent;
  return `${prefix}$$\n${prefix}${latex}\n${prefix}$$`;
}

// ─── Image ──────────────────────────────────────────────────────

function serializeImage(node: PMNode, prefix: string, images: string[]): string {
  const src = node.attrs.src || '';
  const alt = node.attrs.alt || '';

  if (src) images.push(src);

  // 提取 caption（image 的 content 是一个 textBlock）
  let caption = '';
  if (node.firstChild) {
    caption = serializeInlineContent(node.firstChild);
  }

  const altText = alt || caption || 'image';
  return `${prefix}![${altText}](${src})`;
}

// ─── Container blocks (blockquote, frame) ───────────────────────

function serializeContainer(
  node: PMNode,
  linePrefix: string,
  indent: number,
  images: string[],
): string {
  const childLines: string[] = [];
  node.forEach((child) => {
    const md = serializeBlock(child, indent, images);
    if (md !== null) childLines.push(md);
  });
  if (linePrefix) {
    return childLines.map(l => linePrefix + l).join('\n');
  }
  return childLines.join('\n\n');
}

// ─── Callout ────────────────────────────────────────────────────

function serializeCallout(node: PMNode, indent: number, images: string[]): string {
  const emoji = node.attrs.emoji || '💡';
  const childLines: string[] = [];
  node.forEach((child) => {
    const md = serializeBlock(child, indent, images);
    if (md !== null) childLines.push(md);
  });
  // Obsidian-style callout
  const body = childLines.join('\n> ');
  return `> ${emoji} ${body}`;
}

// ─── Lists ──────────────────────────────────────────────────────

function serializeList(
  node: PMNode,
  kind: 'bullet' | 'ordered',
  indent: number,
  images: string[],
): string {
  const items: string[] = [];
  const startNum = node.attrs.start || 1;

  let idx = 0;
  node.forEach((child) => {
    const marker = kind === 'bullet' ? '-' : `${startNum + idx}.`;
    const itemLines: string[] = [];
    child.forEach((grandchild) => {
      const md = serializeBlock(grandchild, 0, images);
      if (md !== null) itemLines.push(md);
    });
    const prefix = '  '.repeat(indent);
    if (itemLines.length > 0) {
      items.push(`${prefix}${marker} ${itemLines[0]}`);
      // 后续行需要缩进对齐
      const continuation = ' '.repeat(marker.length + 1);
      for (let i = 1; i < itemLines.length; i++) {
        items.push(`${prefix}${continuation}${itemLines[i]}`);
      }
    }
    idx++;
  });
  return items.join('\n');
}

// ─── Task List ──────────────────────────────────────────────────

function serializeTaskList(node: PMNode, indent: number, images: string[]): string {
  const items: string[] = [];
  const prefix = '  '.repeat(indent);

  node.forEach((taskItem) => {
    const checked = taskItem.attrs.checked ? 'x' : ' ';
    const itemLines: string[] = [];
    taskItem.forEach((child) => {
      const md = serializeBlock(child, 0, images);
      if (md !== null) itemLines.push(md);
    });
    if (itemLines.length > 0) {
      items.push(`${prefix}- [${checked}] ${itemLines.join(' ')}`);
    }
  });
  return items.join('\n');
}

// ─── Toggle List ────────────────────────────────────────────────

function serializeToggleList(node: PMNode, indent: number, images: string[]): string {
  const childLines: string[] = [];
  let first = true;
  node.forEach((child) => {
    const md = serializeBlock(child, indent, images);
    if (md !== null) {
      if (first) {
        // 第一个子节点是 toggle 标题
        childLines.push(`<details>\n<summary>${md}</summary>\n`);
        first = false;
      } else {
        childLines.push(md);
      }
    }
  });
  childLines.push('</details>');
  return childLines.join('\n\n');
}

// ─── Table ──────────────────────────────────────────────────────

function serializeTable(node: PMNode, prefix: string): string {
  const rows: string[][] = [];
  let hasHeader = false;

  node.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => {
      // 单元格内可能包含多个 block，拼成一行
      const cellParts: string[] = [];
      cell.forEach((child) => {
        const md = serializeBlock(child, 0, []);
        if (md !== null) cellParts.push(md);
      });
      cells.push(cellParts.join(' '));
      if (cell.type.name === 'tableHeader') hasHeader = true;
    });
    rows.push(cells);
  });

  if (rows.length === 0) return '';

  const colCount = Math.max(...rows.map(r => r.length));
  const lines: string[] = [];

  rows.forEach((row, i) => {
    // 补齐列数
    while (row.length < colCount) row.push('');
    lines.push(`${prefix}| ${row.join(' | ')} |`);

    // 在第一行后插入分隔线
    if (i === 0) {
      const sep = row.map(() => '---').join(' | ');
      lines.push(`${prefix}| ${sep} |`);
    }
  });

  return lines.join('\n');
}

// ─── Column Layout ──────────────────────────────────────────────

function serializeColumnList(node: PMNode, indent: number, images: string[]): string {
  const columns: string[] = [];
  let colIdx = 0;
  node.forEach((column) => {
    colIdx++;
    const childLines: string[] = [];
    column.forEach((child) => {
      const md = serializeBlock(child, indent, images);
      if (md !== null) childLines.push(md);
    });
    columns.push(`**[Column ${colIdx}]**\n\n${childLines.join('\n\n')}`);
  });
  return columns.join('\n\n---\n\n');
}

// ─── Media Placeholder ──────────────────────────────────────────

function serializeMediaPlaceholder(node: PMNode, prefix: string, kind: string): string {
  const title = node.attrs.title || '';
  return `${prefix}[${kind}: ${title}]`.trim();
}

// ─── Tweet ──────────────────────────────────────────────────────

function serializeTweet(node: PMNode, prefix: string): string {
  const author = node.attrs.authorName || node.attrs.authorHandle || '';
  const text = node.attrs.text || '';
  const url = node.attrs.tweetUrl || '';
  return `${prefix}> **${author}**: ${text}\n${prefix}> — [Tweet](${url})`;
}
