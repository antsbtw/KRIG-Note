/**
 * blocks-to-pm-nodes — ExtractedBlock[] → ProseMirror Node[]
 *
 * Converts the parsed AI response (ExtractedBlock[]) into ProseMirror nodes
 * that can be directly inserted into the NoteView editor.
 *
 * Uses the BlockRegistry's schema, so all node types are already defined.
 *
 * Design doc: docs/web/AI-Workflow-实施计划.md Step 1.4
 */

import type { Schema, Node as PMNode } from 'prosemirror-model';
import type { ExtractedBlock, ExtractedInline, ExtractedListItem } from '../../../shared/types/extraction-types';

/**
 * Convert ExtractedBlock[] into ProseMirror Node[].
 *
 * @param schema - The ProseMirror schema (from blockRegistry.buildSchema())
 * @param blocks - Parsed blocks from ResultParser
 * @returns Array of ProseMirror nodes ready for tr.insert()
 */
export function blocksToPMNodes(schema: Schema, blocks: ExtractedBlock[]): PMNode[] {
  const nodes: PMNode[] = [];

  for (const block of blocks) {
    const node = blockToNode(schema, block);
    if (node) nodes.push(node);
  }

  return nodes;
}

function blockToNode(schema: Schema, block: ExtractedBlock): PMNode | null {
  switch (block.type) {
    case 'paragraph':
      return createTextBlock(schema, block.text, null, block.inlines);

    case 'heading':
      return createTextBlock(schema, block.text, block.headingLevel, block.inlines);

    case 'code':
      return createCodeBlock(schema, block.text, block.language);

    case 'math':
      return createMathBlock(schema, block.text);

    case 'blockquote':
      return createBlockquote(schema, block.text, block.inlines);

    case 'callout':
      return createCallout(schema, block.text, block.calloutEmoji, block.inlines);

    case 'bulletList':
      return createList(schema, 'bulletList', block.items);

    case 'orderedList':
      return createList(schema, 'orderedList', block.items);

    case 'image':
      return createImage(schema, block.src, block.alt);

    case 'table':
      return createTable(schema, block.tableRows, block.tableHasHeader);

    default:
      // Fallback: render as paragraph
      if (block.text) {
        return createTextBlock(schema, block.text, null);
      }
      return null;
  }
}

// ── Node constructors ──

function createTextBlock(
  schema: Schema,
  text: string,
  level: number | null,
  inlines?: ExtractedInline[],
): PMNode {
  const attrs: Record<string, unknown> = { level: level ?? null };
  const content = inlines && inlines.length > 0
    ? inlinesToContent(schema, inlines)
    : text ? [schema.text(text)] : [];

  return schema.nodes.textBlock.create(attrs, content);
}

function createCodeBlock(schema: Schema, text: string, language?: string): PMNode {
  const attrs = { language: language ?? '' };
  const content = text ? [schema.text(text)] : [];
  return schema.nodes.codeBlock.create(attrs, content);
}

function createMathBlock(schema: Schema, latex: string): PMNode {
  const content = latex ? [schema.text(latex)] : [];
  return schema.nodes.mathBlock.create(null, content);
}

function createBlockquote(schema: Schema, text: string, inlines?: ExtractedInline[]): PMNode {
  // blockquote contains block+ children
  const innerPara = createTextBlock(schema, text, null, inlines);
  return schema.nodes.blockquote.create(null, [innerPara]);
}

function createCallout(schema: Schema, text: string, emoji?: string, inlines?: ExtractedInline[]): PMNode {
  const attrs = { emoji: emoji ?? '💡' };
  const innerPara = createTextBlock(schema, text, null, inlines);
  return schema.nodes.callout.create(attrs, [innerPara]);
}

function createList(schema: Schema, listType: 'bulletList' | 'orderedList', items?: ExtractedListItem[]): PMNode | null {
  if (!items || items.length === 0) return null;

  // bulletList / orderedList contain listItem children
  // listItem nodeSpec is part of the list block — check if it exists
  const listItemType = schema.nodes.listItem;
  const listNodeType = schema.nodes[listType];

  if (!listNodeType) return null;

  // If no listItem type, wrap items in textBlocks directly
  if (!listItemType) {
    const children = items.map(item => {
      const content = item.inlines && item.inlines.length > 0
        ? inlinesToContent(schema, item.inlines)
        : item.text ? [schema.text(item.text)] : [];
      return schema.nodes.textBlock.create(null, content);
    });
    return listNodeType.create(null, children);
  }

  const children = items.map(item => {
    const paraContent = item.inlines && item.inlines.length > 0
      ? inlinesToContent(schema, item.inlines)
      : item.text ? [schema.text(item.text)] : [];
    const para = schema.nodes.textBlock.create(null, paraContent);

    // If list item has nested blocks (e.g., code block inside a list item)
    const nestedBlocks: PMNode[] = [];
    if (item.blocks) {
      for (const b of item.blocks) {
        const n = blockToNode(schema, b);
        if (n) nestedBlocks.push(n);
      }
    }

    return listItemType.create(null, [para, ...nestedBlocks]);
  });

  return listNodeType.create(null, children);
}

function createImage(schema: Schema, src?: string, alt?: string): PMNode | null {
  if (!src || !schema.nodes.image) return null;
  return schema.nodes.image.create({ src, alt: alt ?? '' });
}

function createTable(schema: Schema, rows?: string[][], hasHeader?: boolean): PMNode | null {
  if (!rows || rows.length === 0) return null;
  if (!schema.nodes.table || !schema.nodes.tableRow || !schema.nodes.tableCell) return null;

  const tableRows = rows.map((row, rowIdx) => {
    const isHeader = hasHeader && rowIdx === 0;
    const cellType = isHeader && schema.nodes.tableHeader
      ? schema.nodes.tableHeader
      : schema.nodes.tableCell;

    const cells = row.map(cellText => {
      const para = schema.nodes.textBlock.create(null, cellText ? [schema.text(cellText)] : []);
      return cellType.create(null, [para]);
    });

    return schema.nodes.tableRow.create(null, cells);
  });

  return schema.nodes.table.create(null, tableRows);
}

// ── Inline content ──

function inlinesToContent(schema: Schema, inlines: ExtractedInline[]): PMNode[] {
  const result: PMNode[] = [];

  for (const inline of inlines) {
    switch (inline.type) {
      case 'text':
        if (inline.text) result.push(schema.text(inline.text));
        break;

      case 'bold':
        if (inline.text && schema.marks.bold) {
          result.push(schema.text(inline.text, [schema.marks.bold.create()]));
        }
        break;

      case 'italic':
        if (inline.text && schema.marks.italic) {
          result.push(schema.text(inline.text, [schema.marks.italic.create()]));
        }
        break;

      case 'code-inline':
        if (inline.text && schema.marks.code) {
          result.push(schema.text(inline.text, [schema.marks.code.create()]));
        }
        break;

      case 'link':
        if (inline.text && schema.marks.link) {
          result.push(schema.text(inline.text, [
            schema.marks.link.create({ href: inline.href ?? '' }),
          ]));
        }
        break;

      case 'math-inline':
        // mathInline is a node (not a mark) in KRIG's schema
        if (inline.text && schema.nodes.mathInline) {
          result.push(schema.nodes.mathInline.create(
            { latex: inline.text },
          ));
        }
        break;

      default:
        if (inline.text) result.push(schema.text(inline.text));
    }
  }

  return result;
}
