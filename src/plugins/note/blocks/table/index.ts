import type { BlockDef } from '../../types';
import type { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import { tableEditing, columnResizing, goToNextCell, addRowBefore, addRowAfter, addColumnBefore, addColumnAfter, deleteRow, deleteColumn } from 'prosemirror-tables';
import { keymap } from 'prosemirror-keymap';

/** 将光标移到 table 内第一个 cell（prosemirror-tables 命令需要光标在 cell 内） */
function focusTableCell(view: EditorView, tablePos: number): void {
  const $pos = view.state.doc.resolve(tablePos + 1);
  const sel = TextSelection.near($pos);
  view.dispatch(view.state.tr.setSelection(sel));
}

/**
 * Table — 表格系统（4 个节点）
 *
 * 使用 prosemirror-tables 库。
 * table > tableRow > (tableCell | tableHeader)
 * 每个 Cell 包含 block+（可嵌入任意 Block）。
 */

// ── table ──

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

  capabilities: {
    turnInto: [],
    canDelete: true,
    canDrag: true,
  },

  customActions: [
    { id: 'add-row-above', label: '上方插入行', icon: '⬆', handler: (view, pos) => { focusTableCell(view, pos); addRowBefore(view.state, view.dispatch); return true; }, showIn: ['handleMenu'] },
    { id: 'add-row-below', label: '下方插入行', icon: '⬇', handler: (view, pos) => { focusTableCell(view, pos); addRowAfter(view.state, view.dispatch); return true; }, showIn: ['handleMenu'] },
    { id: 'add-col-left', label: '左侧插入列', icon: '⬅', handler: (view, pos) => { focusTableCell(view, pos); addColumnBefore(view.state, view.dispatch); return true; }, showIn: ['handleMenu'] },
    { id: 'add-col-right', label: '右侧插入列', icon: '➡', handler: (view, pos) => { focusTableCell(view, pos); addColumnAfter(view.state, view.dispatch); return true; }, showIn: ['handleMenu'] },
    { id: 'delete-row', label: '删除行', icon: '✕', handler: (view, pos) => { focusTableCell(view, pos); deleteRow(view.state, view.dispatch); return true; }, showIn: ['handleMenu'] },
    { id: 'delete-col', label: '删除列', icon: '✕', handler: (view, pos) => { focusTableCell(view, pos); deleteColumn(view.state, view.dispatch); return true; }, showIn: ['handleMenu'] },
  ],

  containerRule: {},

  // table plugin 提供表格编辑能力
  plugin: () => tableEditing(),

  slashMenu: {
    label: 'Table',
    icon: '▦',
    group: 'basic',
    keywords: ['table', 'grid', 'spreadsheet'],
    order: 12,
  },
};

// ── tableRow ──

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

// ── tableCell ──

export const tableCellBlock: BlockDef = {
  name: 'tableCell',
  group: '',

  nodeSpec: {
    content: 'block+',
    attrs: {
      colspan: { default: 1 },
      rowspan: { default: 1 },
    },
    tableRole: 'cell',
    isolating: true,
    parseDOM: [{
      tag: 'td',
      getAttrs(dom: HTMLElement) {
        return {
          colspan: Number(dom.getAttribute('colspan') || 1),
          rowspan: Number(dom.getAttribute('rowspan') || 1),
        };
      },
    }],
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

// ── tableHeader ──

export const tableHeaderBlock: BlockDef = {
  name: 'tableHeader',
  group: '',

  nodeSpec: {
    content: 'block+',
    attrs: {
      colspan: { default: 1 },
      rowspan: { default: 1 },
    },
    tableRole: 'header_cell',
    isolating: true,
    parseDOM: [{
      tag: 'th',
      getAttrs(dom: HTMLElement) {
        return {
          colspan: Number(dom.getAttribute('colspan') || 1),
          rowspan: Number(dom.getAttribute('rowspan') || 1),
        };
      },
    }],
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

// ── Table Tab 键导航 Plugin ──

export function tableKeymapPlugin() {
  return keymap({
    'Tab': goToNextCell(1),
    'Shift-Tab': goToNextCell(-1),
  });
}
