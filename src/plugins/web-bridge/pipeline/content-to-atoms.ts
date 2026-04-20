import { createAtom } from '../../../shared/types/atom-types';
import type {
  Atom,
  InlineElement,
  ParagraphContent,
  HeadingContent,
  BlockquoteContent,
  CalloutContent,
  ImageContent,
  VideoContent,
  AudioContent,
  ListContent,
  ListItemContent,
  TableContent,
  TableCellContent,
  NoteTitleContent,
  FileBlockContent,
  HtmlBlockContent,
} from '../../../shared/types/atom-types';
import type { ExtractedBlock, ExtractedInline } from '../../../shared/types/extraction-types';

/**
 * Normalize inline elements: clean whitespace, merge adjacent text nodes, trim edges
 */
function normalizeInlines(elements: InlineElement[]): InlineElement[] {
  const result: InlineElement[] = [];

  for (const el of elements) {
    if (el.type === 'text') {
      // Replace \n with space, collapse multiple spaces
      const cleaned = el.text.replace(/\n/g, ' ').replace(/\s{2,}/g, ' ');
      if (!cleaned.trim()) continue;

      // Merge with previous text node if both are plain (no marks)
      const prev = result[result.length - 1];
      if (prev && prev.type === 'text' && !prev.marks?.length && !el.marks?.length) {
        prev.text += cleaned;
        continue;
      }
      result.push({ ...el, text: cleaned });
    } else {
      result.push(el);
    }
  }

  // Trim first and last text nodes
  if (result.length > 0) {
    const first = result[0];
    if (first.type === 'text') first.text = first.text.replace(/^\s+/, '');
    const last = result[result.length - 1];
    if (last.type === 'text') last.text = last.text.replace(/\s+$/, '');
  }

  return result.filter(el => el.type !== 'text' || el.text.length > 0);
}

/**
 * Convert extracted inline elements to Atom InlineElement[]
 * Falls back to plain text if no inlines provided
 */
function toInlineElements(inlines: ExtractedInline[] | undefined, fallbackText: string): InlineElement[] {
  if (!inlines || inlines.length === 0) {
    return [{ type: 'text', text: fallbackText }];
  }

  const mapped: InlineElement[] = inlines.map(inline => {
    if (inline.type === 'link' && inline.href) {
      return {
        type: 'link' as const,
        href: inline.href,
        children: [{ type: 'text' as const, text: inline.text }],
      };
    }
    if (inline.type === 'math-inline') {
      return { type: 'math-inline' as const, latex: inline.text };
    }
    if (inline.type === 'code-inline') {
      return { type: 'code-inline' as const, code: inline.text };
    }
    if (inline.type === 'file-link' && inline.href) {
      return {
        type: 'file-link' as const,
        src: inline.href,
        filename: inline.text,
      };
    }
    if (inline.type === 'bold') {
      return { type: 'text' as const, text: inline.text, marks: [{ type: 'bold' as const }] };
    }
    if (inline.type === 'italic') {
      return { type: 'text' as const, text: inline.text, marks: [{ type: 'italic' as const }] };
    }
    return { type: 'text' as const, text: inline.text };
  });

  return normalizeInlines(mapped);
}

/**
 * Convert InlineElement[] to Tiptap JSON content (for table cells etc.)
 */
function inlineElementsToTiptapContent(elements: InlineElement[]): Array<Record<string, unknown>> {
  if (elements.length === 0) return [];
  return elements.map(el => {
    if (el.type === 'math-inline') {
      return { type: 'mathInline', attrs: { latex: el.latex } };
    }
    if (el.type === 'code-inline') {
      return { type: 'text', text: el.code, marks: [{ type: 'code' }] };
    }
    if (el.type === 'file-link') {
      return { type: 'fileLink', attrs: { src: el.src, filename: el.filename } };
    }
    if (el.type === 'link') {
      return {
        type: 'text',
        text: el.children.map(c => c.text).join(''),
        marks: [{ type: 'link', attrs: { href: el.href } }],
      };
    }
    if (el.type === 'text') {
      if (!el.text) return null; // Skip empty text nodes (ProseMirror rejects them)
      const node: Record<string, unknown> = { type: 'text', text: el.text };
      if (el.marks?.length) {
        node.marks = el.marks.map(m => ({ type: m.type }));
      }
      return node;
    }
    return null;
  }).filter(Boolean) as Array<Record<string, unknown>>;
}

/**
 * Quick inline parser for table cell text: extracts $...$ math, `code`, **bold**, *italic*
 * Returns ExtractedInline[] compatible with toInlineElements()
 */
function parseCellInlines(text: string): ExtractedInline[] {
  if (!text) return [];
  const inlines: ExtractedInline[] = [];
  // Links [text](url), $math$, `code`, **bold**, *italic*
  const regex = /\[([^\]]+)\]\(([^)]+)\)|\$([^$\n]+)\$|`([^`\n]+)`|\*\*([^*]+)\*\*|\*([^*\n]+)\*/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      inlines.push({ type: 'text', text: text.slice(lastIdx, match.index) });
    }
    if (match[1] !== undefined) {
      inlines.push({ type: 'link', text: match[1], href: match[2] });
    } else if (match[3] !== undefined) {
      inlines.push({ type: 'math-inline', text: match[3] });
    } else if (match[4] !== undefined) {
      inlines.push({ type: 'code-inline', text: match[4] });
    } else if (match[5] !== undefined) {
      inlines.push({ type: 'bold', text: match[5] });
    } else if (match[6] !== undefined) {
      inlines.push({ type: 'italic', text: match[6] });
    }
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) {
    inlines.push({ type: 'text', text: text.slice(lastIdx) });
  }
  return inlines.length > 0 ? inlines : [{ type: 'text', text }];
}

/**
 * Convert an ExtractedBlock directly to a Tiptap JSON node (no Atom creation).
 * Used for nested blocks inside list items.
 */
function blockToTiptapNode(block: ExtractedBlock): Record<string, unknown> {
  if (block.type === 'math') {
    return {
      type: 'mathBlock',
      content: block.text ? [{ type: 'text', text: block.text }] : [],
    };
  }
  if (block.type === 'code') {
    return {
      type: 'codeBlock',
      attrs: block.language ? { language: block.language } : undefined,
      content: block.text ? [{ type: 'text', text: block.text }] : [],
    };
  }
  if (block.type === 'image' && block.src) {
    return {
      type: 'image',
      attrs: {
        src: block.src,
        alt: block.alt || null,
        caption: block.caption || null,
        originalSrc: block.pageRef ? `image:page${block.pageRef}` : undefined,
      },
    };
  }
  if (block.type === 'table' && block.tableRows?.length) {
    const tiptapRows = block.tableRows.map((row, rowIdx) => {
      const isHeaderRow = rowIdx === 0 && block.tableHasHeader;
      const cellType = isHeaderRow ? 'tableHeader' : 'tableCell';
      const cells = row.map(cellText => {
        if (!cellText.trim()) {
          return { type: cellType, attrs: { colspan: 1, rowspan: 1 }, content: [{ type: 'paragraph' }] };
        }
        const inlineElements = toInlineElements(parseCellInlines(cellText), cellText);
        const tiptapContent = inlineElementsToTiptapContent(inlineElements);
        return { type: cellType, attrs: { colspan: 1, rowspan: 1 }, content: [{ type: 'paragraph', content: tiptapContent }] };
      });
      return { type: 'tableRow', content: cells };
    });
    return { type: 'table', content: tiptapRows };
  }
  // Default: paragraph
  const inlineElements = toInlineElements(block.inlines, block.text);
  const tiptapContent = inlineElementsToTiptapContent(inlineElements);
  return {
    type: 'paragraph',
    content: tiptapContent.length > 0 ? tiptapContent : undefined,
  };
}

/**
 * 将提取的内容块转为 Atom 数组（保留原始布局）
 * 支持类型：paragraph / heading / blockquote / image / bulletList / orderedList
 * 支持 inline 链接保留
 */
export function createAtomsFromExtracted(blocks: ExtractedBlock[], pageTitle?: string): Atom[] {
  const rootAtom = createAtom('document', {});
  const atoms: Atom[] = [rootAtom];

  // Create partTitle atom from pageTitle or first heading
  let titleText = pageTitle || '';
  let skipFirstHeading = false;

  if (!titleText) {
    const firstHeading = blocks.find(b => b.type === 'heading');
    if (firstHeading) {
      titleText = firstHeading.text;
      skipFirstHeading = true;
    } else {
      titleText = 'Untitled';
    }
  }

  const titleContent: NoteTitleContent = {
    children: [{ type: 'text', text: titleText }],
  };
  atoms.push(createAtom('noteTitle', titleContent, rootAtom.id));

  for (const block of blocks) {
    // Skip first heading if it was used as partTitle
    if (skipFirstHeading && block.type === 'heading' && block.text === titleText) {
      skipFirstHeading = false;
      continue;
    }
    if (block.type === 'image' && block.src) {
      // Encode pageRef + bbox into originalSrc for PDFController to resolve later
      let originalSrc: string | undefined;
      if (block.pageRef) {
        originalSrc = `image:page${block.pageRef}`;
        if (block.bbox) {
          originalSrc += `:x${block.bbox.x},y${block.bbox.y},w${block.bbox.w},h${block.bbox.h}`;
        }
      }
      const content: ImageContent = {
        src: block.src,
        alt: block.alt,
        width: block.width,
        height: block.height,
        caption: block.caption,
        originalSrc,
      };
      atoms.push(createAtom('image', content, rootAtom.id));

    } else if (block.type === 'video' && block.src) {
      const content: VideoContent = {
        src: block.src,
        title: block.text || 'Video',
        poster: block.poster,
        duration: block.duration,
      };
      atoms.push(createAtom('video', content, rootAtom.id));

    } else if (block.type === 'audio' && block.src) {
      const content: AudioContent = {
        src: block.src,
        title: block.text || 'Audio',
      };
      atoms.push(createAtom('audio', content, rootAtom.id));

    } else if (block.type === 'htmlBlock' && block.src) {
      const content: HtmlBlockContent = {
        src: block.src,
        title: block.text || 'HTML Preview',
      };
      atoms.push(createAtom('htmlBlock', content, rootAtom.id));

    } else if (block.type === 'file' && block.src) {
      const content: FileBlockContent = {
        mediaId: '',
        src: block.src,
        filename: block.filename || block.text || 'attachment',
        mimeType: block.mimeType || '',
        size: block.size,
        source: 'ai-generated',
      };
      atoms.push(createAtom('fileBlock', content, rootAtom.id));

    } else if (block.type === 'bulletList' || block.type === 'orderedList') {
      const listContent: ListContent = {
        listType: block.type === 'bulletList' ? 'bullet' : 'ordered',
      };
      const listAtom = createAtom(block.type, listContent, rootAtom.id);
      atoms.push(listAtom);

      // Create listItem child atoms
      if (block.items) {
        for (const item of block.items) {
          const itemContent: ListItemContent = {
            children: toInlineElements(item.inlines, item.text),
          };
          atoms.push(createAtom('listItem', itemContent, listAtom.id));
        }
      }

    } else if (block.type === 'heading' && block.headingLevel >= 1) {
      // KRIG supports h1-h3 only; clamp h4-h6 to h3
      const level = Math.min(block.headingLevel, 3) as 1 | 2 | 3;
      const content: HeadingContent = {
        level,
        children: toInlineElements(block.inlines, block.text),
      };
      atoms.push(createAtom('heading', content, rootAtom.id));

    } else if (block.type === 'callout') {
      // Callout → callout atom with emoji — content as paragraph child
      const calloutAtom = createAtom('callout', {
        calloutType: (block.calloutType as CalloutContent['calloutType']) || 'info',
        emoji: block.calloutEmoji || '💡',
      } as CalloutContent, rootAtom.id);
      atoms.push(calloutAtom);
      // Add callout body as paragraph child
      const bodyContent: ParagraphContent = {
        children: toInlineElements(block.inlines, block.text),
      };
      atoms.push(createAtom('paragraph', bodyContent, calloutAtom.id));

    } else if (block.type === 'blockquote') {
      const content: BlockquoteContent = {
        children: toInlineElements(block.inlines, block.text),
      };
      atoms.push(createAtom('blockquote', content, rootAtom.id));

    } else if (block.type === 'code') {
      // Code block → codeBlock atom
      atoms.push(createAtom('codeBlock', {
        code: block.text,
        language: block.language || '',
      }, rootAtom.id));

    } else if (block.type === 'table' && block.tableRows?.length) {
      // Table → table atom with tableRow + tableCell children
      const colCount = Math.max(...block.tableRows.map(r => r.length));
      const tableAtom = createAtom('table', { colCount } as TableContent, rootAtom.id);
      atoms.push(tableAtom);

      for (let rowIdx = 0; rowIdx < block.tableRows.length; rowIdx++) {
        const row = block.tableRows[rowIdx];
        const isHeader = rowIdx === 0 && block.tableHasHeader;
        const rowAtom = createAtom('tableRow', {} as any, tableAtom.id);
        atoms.push(rowAtom);

        for (const cellText of row) {
          const cellContent: TableCellContent = {
            children: toInlineElements(parseCellInlines(cellText), cellText),
            isHeader,
          };
          atoms.push(createAtom('tableCell', cellContent, rowAtom.id));
        }
      }

    } else if (block.type === 'math') {
      // Math block → mathBlock atom
      atoms.push(createAtom('mathBlock', {
        latex: block.text,
      }, rootAtom.id));

    } else if (block.tag === 'hr') {
      // Horizontal rule
      atoms.push(createAtom('horizontalRule', {} as any, rootAtom.id));

    } else {
      // paragraph → paragraph
      const content: ParagraphContent = {
        children: toInlineElements(block.inlines, block.text),
      };
      atoms.push(createAtom('paragraph', content, rootAtom.id));
    }
  }

  return atoms;
}
