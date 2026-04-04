import type { BlockDef } from '../types';
import { keymap } from 'prosemirror-keymap';
import { tableEditing, goToNextCell } from 'prosemirror-tables';

/**
 * Table — 表格系统（4 个节点）
 *
 * 使用 prosemirror-tables 库。
 * table > tableRow > (tableCell | tableHeader)
 * 每个 Cell 包含 block+。
 */

export const tableBlock: BlockDef = {
  name: 'table',
  group: 'block',
  nodeSpec: {
    content: 'tableRow+',
    group: 'block',
    tableRole: 'table',
    isolating: true,
    parseDOM: [{ tag: 'table' }],
    toDOM() { return ['table', ['tbody', 0]]; },
  },
  capabilities: { canDelete: true, canDrag: true },
  containerRule: {},
  plugin: () => tableEditing(),
  slashMenu: { label: 'Table', icon: '▦', group: 'basic', keywords: ['table', 'grid', '表格'], order: 12 },
};

export const tableRowBlock: BlockDef = {
  name: 'tableRow',
  group: '',
  nodeSpec: {
    content: '(tableCell | tableHeader)+',
    tableRole: 'row',
    parseDOM: [{ tag: 'tr' }],
    toDOM() { return ['tr', 0]; },
  },
  capabilities: {},
  slashMenu: null,
};

export const tableCellBlock: BlockDef = {
  name: 'tableCell',
  group: '',
  nodeSpec: {
    content: 'block+',
    attrs: { colspan: { default: 1 }, rowspan: { default: 1 } },
    tableRole: 'cell',
    isolating: true,
    parseDOM: [{ tag: 'td', getAttrs(dom: HTMLElement) {
      return { colspan: Number(dom.getAttribute('colspan') || 1), rowspan: Number(dom.getAttribute('rowspan') || 1) };
    }}],
    toDOM(node) {
      const attrs: Record<string, string> = {};
      if (node.attrs.colspan !== 1) attrs.colspan = String(node.attrs.colspan);
      if (node.attrs.rowspan !== 1) attrs.rowspan = String(node.attrs.rowspan);
      return ['td', attrs, 0];
    },
  },
  capabilities: {},
  slashMenu: null,
};

export const tableHeaderBlock: BlockDef = {
  name: 'tableHeader',
  group: '',
  nodeSpec: {
    content: 'block+',
    attrs: { colspan: { default: 1 }, rowspan: { default: 1 } },
    tableRole: 'header_cell',
    isolating: true,
    parseDOM: [{ tag: 'th', getAttrs(dom: HTMLElement) {
      return { colspan: Number(dom.getAttribute('colspan') || 1), rowspan: Number(dom.getAttribute('rowspan') || 1) };
    }}],
    toDOM(node) {
      const attrs: Record<string, string> = {};
      if (node.attrs.colspan !== 1) attrs.colspan = String(node.attrs.colspan);
      if (node.attrs.rowspan !== 1) attrs.rowspan = String(node.attrs.rowspan);
      return ['th', attrs, 0];
    },
  },
  capabilities: {},
  slashMenu: null,
};

export function tableKeymapPlugin() {
  return keymap({ 'Tab': goToNextCell(1), 'Shift-Tab': goToNextCell(-1) });
}
