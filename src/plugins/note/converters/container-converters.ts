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
    // blockquote 的内容由子 Atom 填充（ConverterRegistry 处理）
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
    const c = atom.content as CalloutContent;
    return {
      type: 'callout',
      attrs: { calloutType: c.calloutType, emoji: c.emoji, title: c.title },
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

  toPM(atom: Atom): PMNodeJSON {
    // table 的内容由子 Atom（tableRow → tableCell）填充
    return { type: 'table' };
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
    const c = atom.content as ColumnListContent;
    return {
      type: 'columnList',
      attrs: { columns: c.columns },
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
