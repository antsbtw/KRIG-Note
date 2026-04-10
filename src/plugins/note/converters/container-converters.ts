/**
 * Container Converters
 *
 * blockquote / callout / toggleList / frameBlock / table / columnList ↔ Atom
 *
 * 容器节点的子节点由 ConverterRegistry 递归处理（parentId 关联）。
 * Converter 只负责容器本身的 attrs ↔ content 映射。
 */

import type { Node as PMNode } from 'prosemirror-model';
import type {
  Atom,
  BlockquoteContent,
  CalloutContent,
  ToggleListContent,
  FrameBlockContent,
  TableContent,
  TableCellContent,
  ColumnListContent,
} from '../../../shared/types/atom-types';
import { createAtom } from '../../../shared/types/atom-types';
import type { AtomConverter, PMNodeJSON } from './converter-types';
import { pmInlinesToAtom, atomInlinesToPM } from './inline-utils';

// ── blockquote ──

export const blockquoteConverter: AtomConverter = {
  atomTypes: ['blockquote'],
  pmType: 'blockquote',

  toAtom(node: PMNode, parentId?: string): Atom {
    // blockquote 的第一个子节点文本作为 children
    const firstChild = node.content.firstChild;
    const children = firstChild && !firstChild.isBlock ? pmInlinesToAtom(firstChild) : [];
    return createAtom('blockquote', { children } as BlockquoteContent, parentId);
  },

  toPM(atom: Atom): PMNodeJSON {
    const c = atom.content as Record<string, unknown>;
    // PDF 提取的多段 blockquote：内容在 tiptapContent 中
    if (Array.isArray(c.tiptapContent) && c.tiptapContent.length > 0) {
      return {
        type: 'blockquote',
        content: fixTiptapNodeTypes(c.tiptapContent as PMNodeJSON[]),
      };
    }
    // 单段 blockquote：inline children 包裹在 textBlock 中
    const bq = c as unknown as BlockquoteContent;
    if (bq.children && bq.children.length > 0) {
      return {
        type: 'blockquote',
        content: [{ type: 'textBlock', content: atomInlinesToPM(bq.children) }],
      };
    }
    // 否则由 ConverterRegistry 用子 Atom 填充 content
    return { type: 'blockquote' };
  },
};

// ── callout ──

export const calloutConverter: AtomConverter = {
  atomTypes: ['callout'],
  pmType: 'callout',

  toAtom(node: PMNode, parentId?: string): Atom {
    return createAtom('callout', {
      calloutType: node.attrs.calloutType || 'info',
      emoji: node.attrs.emoji || undefined,
      title: node.attrs.title || undefined,
    } as CalloutContent, parentId);
  },

  toPM(atom: Atom): PMNodeJSON {
    const c = atom.content as Record<string, unknown>;
    const emoji = (c as unknown as CalloutContent).emoji || '💡';
    // PDF 提取的 callout：内容在 tiptapContent 中
    if (Array.isArray(c.tiptapContent) && c.tiptapContent.length > 0) {
      return {
        type: 'callout',
        attrs: { emoji },
        content: fixTiptapNodeTypes(c.tiptapContent as PMNodeJSON[]),
      };
    }
    return {
      type: 'callout',
      attrs: { emoji },
    };
  },
};

// ── toggleList ──

export const toggleListConverter: AtomConverter = {
  atomTypes: ['toggleList'],
  pmType: 'toggleList',

  toAtom(node: PMNode, parentId?: string): Atom {
    return createAtom('toggleList', {
      open: node.attrs.open ?? true,
      title: '',
    } as ToggleListContent, parentId);
  },

  toPM(atom: Atom): PMNodeJSON {
    const c = atom.content as ToggleListContent;
    return {
      type: 'toggleList',
      attrs: { open: c.open },
    };
  },
};

// ── frameBlock ──

export const frameBlockConverter: AtomConverter = {
  atomTypes: ['frameBlock'],
  pmType: 'frameBlock',

  toAtom(node: PMNode, parentId?: string): Atom {
    return createAtom('frameBlock', {
      label: node.attrs.label || undefined,
    } as FrameBlockContent, parentId);
  },

  toPM(atom: Atom): PMNodeJSON {
    const c = atom.content as FrameBlockContent;
    return {
      type: 'frameBlock',
      attrs: { label: c.label },
    };
  },
};

// ── table ──

export const tableConverter: AtomConverter = {
  atomTypes: ['table'],
  pmType: 'table',

  toAtom(node: PMNode, parentId?: string): Atom {
    // 从第一行推断列数
    const firstRow = node.content.firstChild;
    const colCount = firstRow ? firstRow.childCount : 0;
    return createAtom('table', { colCount } as TableContent, parentId);
  },

  toPM(atom: Atom, children?: Atom[]): PMNodeJSON {
    const c = atom.content as Record<string, unknown>;
    // PDF 提取的 table：内容在 tiptapContent 中，映射 paragraph → textBlock
    if (Array.isArray(c.tiptapContent) && c.tiptapContent.length > 0) {
      return {
        type: 'table',
        content: fixTiptapNodeTypes(c.tiptapContent as PMNodeJSON[]),
      };
    }
    // 子 Atom 模式（编辑器内部保存的 table）
    if (children && children.length > 0) {
      return { type: 'table' };
    }
    // 无内容 → 降级为占位段落（避免空 table 崩溃）
    return { type: 'textBlock', content: [{ type: 'text', text: '[empty table]' }] };
  },
};

// ── tableRow ──

export const tableRowConverter: AtomConverter = {
  atomTypes: ['tableRow'],
  pmType: 'tableRow',

  toAtom(_node: PMNode, parentId?: string): Atom {
    return createAtom('tableRow', {} as any, parentId);
  },

  toPM(): PMNodeJSON {
    return { type: 'tableRow' };
  },
};

// ── tableCell ──

export const tableCellConverter: AtomConverter = {
  atomTypes: ['tableCell'],
  pmType: 'tableCell',

  toAtom(node: PMNode, parentId?: string): Atom {
    const firstChild = node.content.firstChild;
    const children = firstChild ? pmInlinesToAtom(firstChild) : [];
    return createAtom('tableCell', {
      children,
      colspan: node.attrs.colspan > 1 ? node.attrs.colspan : undefined,
      rowspan: node.attrs.rowspan > 1 ? node.attrs.rowspan : undefined,
    } as TableCellContent, parentId);
  },

  toPM(atom: Atom): PMNodeJSON {
    const c = atom.content as TableCellContent;
    return {
      type: 'tableCell',
      attrs: { colspan: c.colspan ?? 1, rowspan: c.rowspan ?? 1 },
      content: [{ type: 'textBlock', content: atomInlinesToPM(c.children) }],
    };
  },
};

// ── tableHeader ──

export const tableHeaderConverter: AtomConverter = {
  atomTypes: ['tableHeader'],
  pmType: 'tableHeader',

  toAtom(node: PMNode, parentId?: string): Atom {
    const firstChild = node.content.firstChild;
    const children = firstChild ? pmInlinesToAtom(firstChild) : [];
    return createAtom('tableHeader', {
      children,
      isHeader: true,
      colspan: node.attrs.colspan > 1 ? node.attrs.colspan : undefined,
      rowspan: node.attrs.rowspan > 1 ? node.attrs.rowspan : undefined,
    } as TableCellContent, parentId);
  },

  toPM(atom: Atom): PMNodeJSON {
    const c = atom.content as TableCellContent;
    return {
      type: 'tableHeader',
      attrs: { colspan: c.colspan ?? 1, rowspan: c.rowspan ?? 1 },
      content: [{ type: 'textBlock', content: atomInlinesToPM(c.children) }],
    };
  },
};

// ── columnList ──

export const columnListConverter: AtomConverter = {
  atomTypes: ['columnList'],
  pmType: 'columnList',

  toAtom(node: PMNode, parentId?: string): Atom {
    return createAtom('columnList', {
      columns: node.attrs.columns || node.childCount,
    } as ColumnListContent, parentId);
  },

  toPM(atom: Atom): PMNodeJSON {
    const c = atom.content as Record<string, unknown>;
    const columns = (c as unknown as ColumnListContent).columns || 2;
    // PDF 提取的 columnList：内容在 tiptapContent 中
    if (Array.isArray(c.tiptapContent) && c.tiptapContent.length > 0) {
      return {
        type: 'columnList',
        attrs: { columns },
        content: fixTiptapNodeTypes(c.tiptapContent as PMNodeJSON[]),
      };
    }
    return {
      type: 'columnList',
      attrs: { columns },
    };
  },
};

// ── column ──

export const columnConverter: AtomConverter = {
  atomTypes: ['column'],
  pmType: 'column',

  toAtom(_node: PMNode, parentId?: string): Atom {
    return createAtom('column', {} as any, parentId);
  },

  toPM(): PMNodeJSON {
    return { type: 'column' };
  },
};

// ── tiptapContent 节点类型修正 ──

/** 递归修正 tiptapContent 中与 KRIG-Note schema 不一致的节点类型名 */
function fixTiptapNodeTypes(nodes: PMNodeJSON[]): PMNodeJSON[] {
  return nodes.map(node => {
    const type = node.type === 'paragraph' ? 'textBlock' : node.type;
    const result: PMNodeJSON = { ...node, type };
    if (Array.isArray(result.content)) {
      result.content = fixTiptapNodeTypes(result.content);
    }
    return result;
  });
}

