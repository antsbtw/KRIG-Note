import type { BlockDef } from '../types';
import { keymap } from 'prosemirror-keymap';
import { tableEditing, goToNextCell, columnResizing, addRowAfter } from 'prosemirror-tables';
import { tableNodeView } from './table/view';

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
    toDOM() { return ['table', { class: 'pm-table' }, ['tbody', 0]]; },
  },
  nodeView: tableNodeView,
  capabilities: {
    turnInto: [],
    canDuplicate: true,
    canDelete: true,
    canDrag: true,
    cascadeBoundary: true,
  },
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
  capabilities: { cascadeBoundary: true },
  slashMenu: null,
};

export const tableCellBlock: BlockDef = {
  name: 'tableCell',
  group: '',
  nodeSpec: {
    content: 'block+',
    attrs: {
      colspan: { default: 1 },
      rowspan: { default: 1 },
      colwidth: { default: null },
    },
    tableRole: 'cell',
    isolating: true,
    parseDOM: [{ tag: 'td', getAttrs(dom: HTMLElement) {
      const widthAttr = dom.getAttribute('data-colwidth');
      const colwidth = widthAttr ? widthAttr.split(',').map(Number) : null;
      return {
        colspan: Number(dom.getAttribute('colspan') || 1),
        rowspan: Number(dom.getAttribute('rowspan') || 1),
        colwidth,
      };
    }}],
    toDOM(node) {
      const attrs: Record<string, string> = {};
      if (node.attrs.colspan > 1) attrs.colspan = String(node.attrs.colspan);
      if (node.attrs.rowspan > 1) attrs.rowspan = String(node.attrs.rowspan);
      if (node.attrs.colwidth) {
        attrs['data-colwidth'] = (node.attrs.colwidth as number[]).join(',');
        attrs.style = `width: ${(node.attrs.colwidth as number[])[0]}px`;
      }
      return ['td', attrs, 0];
    },
  },
  capabilities: { cascadeBoundary: true },
  containerRule: { requiredFirstChildType: undefined },
  slashMenu: null,
};

export const tableHeaderBlock: BlockDef = {
  name: 'tableHeader',
  group: '',
  nodeSpec: {
    content: 'block+',
    attrs: {
      colspan: { default: 1 },
      rowspan: { default: 1 },
      colwidth: { default: null },
    },
    tableRole: 'header_cell',
    isolating: true,
    parseDOM: [{ tag: 'th', getAttrs(dom: HTMLElement) {
      const widthAttr = dom.getAttribute('data-colwidth');
      const colwidth = widthAttr ? widthAttr.split(',').map(Number) : null;
      return {
        colspan: Number(dom.getAttribute('colspan') || 1),
        rowspan: Number(dom.getAttribute('rowspan') || 1),
        colwidth,
      };
    }}],
    toDOM(node) {
      const attrs: Record<string, string> = {};
      if (node.attrs.colspan > 1) attrs.colspan = String(node.attrs.colspan);
      if (node.attrs.rowspan > 1) attrs.rowspan = String(node.attrs.rowspan);
      if (node.attrs.colwidth) {
        attrs['data-colwidth'] = (node.attrs.colwidth as number[]).join(',');
        attrs.style = `width: ${(node.attrs.colwidth as number[])[0]}px`;
      }
      return ['th', attrs, 0];
    },
  },
  capabilities: { cascadeBoundary: true },
  containerRule: { requiredFirstChildType: undefined },
  slashMenu: null,
};

export function tableKeymapPlugin() {
  return keymap({
    'Tab': (state, dispatch, view) => {
      // Tab → next cell; at last cell → add new row
      if (goToNextCell(1)(state, dispatch)) return true;
      if (dispatch) addRowAfter(state, dispatch);
      return true;
    },
    'Shift-Tab': goToNextCell(-1),
  });
}
