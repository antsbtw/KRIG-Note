/**
 * table/view.ts — Table NodeView
 *
 * Renders a table with:
 * - Column header indicators (top) — click to show add/delete menu
 * - Row header indicators (left) — click to show add/delete menu
 * - +row / +col buttons on hover (bottom / right)
 * contentDOM = tbody, so ProseMirror manages rows/cells inside.
 */

import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import {
  addColumnAfter, addColumnBefore, deleteColumn,
  addRowAfter, addRowBefore, deleteRow,
  updateColumnsOnResize,
} from 'prosemirror-tables';
import { duplicateRow, duplicateColumn } from './commands';
import type { NodeViewFactory } from '../../types';

// ─── Helper: place cursor into a specific cell ─────────────

function selectCell(view: EditorView, tablePos: number, rowIdx: number, colIdx: number): boolean {
  const tableNode = view.state.doc.nodeAt(tablePos);
  if (!tableNode) return false;

  let rowStart = tablePos + 1; // skip table open tag
  for (let r = 0; r < rowIdx; r++) {
    rowStart += tableNode.child(r).nodeSize;
  }

  const row = tableNode.child(rowIdx);
  let cellStart = rowStart + 1; // skip row open tag
  for (let c = 0; c < colIdx; c++) {
    cellStart += row.child(c).nodeSize;
  }

  // cellStart is at the cell open tag, +1 to get inside the cell's first child
  const insideCell = cellStart + 1;
  try {
    const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, insideCell));
    view.dispatch(tr);
    return true;
  } catch {
    return false;
  }
}

// ─── Helper: context menu for row/column operations ─────────

interface MenuAction {
  label: string;
  action: () => void;
  danger?: boolean;
}

function showContextMenu(
  anchorEl: HTMLElement,
  actions: MenuAction[],
  position: 'below' | 'right' = 'below',
) {
  // Remove any existing menu
  const existing = document.querySelector('.table-ctx-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.classList.add('table-ctx-menu');
  menu.setAttribute('contenteditable', 'false');

  for (const act of actions) {
    const item = document.createElement('div');
    item.classList.add('table-ctx-menu__item');
    if (act.danger) item.classList.add('table-ctx-menu__item--danger');
    item.textContent = act.label;
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      menu.remove();
      act.action();
    });
    menu.appendChild(item);
  }

  document.body.appendChild(menu);

  // Position relative to anchor
  const rect = anchorEl.getBoundingClientRect();
  if (position === 'below') {
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 2}px`;
  } else {
    menu.style.left = `${rect.right + 2}px`;
    menu.style.top = `${rect.top}px`;
  }

  // Close on outside click
  const closeHandler = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) {
      menu.remove();
      document.removeEventListener('mousedown', closeHandler, true);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', closeHandler, true), 0);
}

// ─── Helper: build row / column indicators ──────────────────

function buildColumnIndicators(
  dom: HTMLElement,
  table: HTMLTableElement,
  view: EditorView,
  getPos: () => number | undefined,
) {
  dom.querySelectorAll('.table-col-indicators').forEach(el => el.remove());

  const headerRow = table.querySelector('tbody tr:first-child');
  if (!headerRow) return;
  const cells = headerRow.querySelectorAll('th, td');
  if (cells.length === 0) return;

  const container = document.createElement('div');
  container.classList.add('table-col-indicators');
  container.setAttribute('contenteditable', 'false');

  cells.forEach((_, colIdx) => {
    const indicator = document.createElement('div');
    indicator.classList.add('table-col-indicator');
    indicator.dataset.colIdx = String(colIdx);
    indicator.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = getPos();
      if (pos == null) return;
      selectCell(view, pos, 0, colIdx);
      showContextMenu(indicator, [
        { label: '← Insert column before', action: () => { addColumnBefore(view.state, view.dispatch); } },
        { label: '→ Insert column after', action: () => { addColumnAfter(view.state, view.dispatch); } },
        { label: '⧉ Duplicate column', action: () => { duplicateColumn(view.state, view.dispatch); } },
        { label: 'Delete column', danger: true, action: () => { deleteColumn(view.state, view.dispatch); } },
      ], 'below');
    });
    container.appendChild(indicator);
  });

  dom.appendChild(container);
}

function buildRowIndicators(
  dom: HTMLElement,
  table: HTMLTableElement,
  view: EditorView,
  getPos: () => number | undefined,
) {
  dom.querySelectorAll('.table-row-indicators').forEach(el => el.remove());

  const rows = table.querySelectorAll('tbody tr');
  if (rows.length === 0) return;

  const container = document.createElement('div');
  container.classList.add('table-row-indicators');
  container.setAttribute('contenteditable', 'false');

  rows.forEach((_, rowIdx) => {
    const indicator = document.createElement('div');
    indicator.classList.add('table-row-indicator');
    indicator.dataset.rowIdx = String(rowIdx);
    indicator.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = getPos();
      if (pos == null) return;
      selectCell(view, pos, rowIdx, 0);
      showContextMenu(indicator, [
        { label: '↑ Insert row above', action: () => { addRowBefore(view.state, view.dispatch); } },
        { label: '↓ Insert row below', action: () => { addRowAfter(view.state, view.dispatch); } },
        { label: '⧉ Duplicate row', action: () => { duplicateRow(view.state, view.dispatch); } },
        { label: 'Delete row', danger: true, action: () => { deleteRow(view.state, view.dispatch); } },
      ], 'right');
    });
    container.appendChild(indicator);
  });

  dom.appendChild(container);
}

/** Update indicator positions based on actual cell/row positions */
function updateIndicatorPositions(dom: HTMLElement, table: HTMLTableElement) {
  const wrapperRect = dom.getBoundingClientRect();

  // Column indicators
  const colIndicators = dom.querySelectorAll('.table-col-indicator') as NodeListOf<HTMLElement>;
  const headerRow = table.querySelector('tbody tr:first-child');
  if (headerRow) {
    const cells = headerRow.querySelectorAll('th, td');
    colIndicators.forEach((indicator, idx) => {
      if (idx < cells.length) {
        const cellRect = cells[idx].getBoundingClientRect();
        indicator.style.left = `${cellRect.left - wrapperRect.left}px`;
        indicator.style.width = `${cellRect.width}px`;
      }
    });
  }

  // Row indicators
  const rowIndicators = dom.querySelectorAll('.table-row-indicator') as NodeListOf<HTMLElement>;
  const rows = table.querySelectorAll('tbody tr');
  rowIndicators.forEach((indicator, idx) => {
    if (idx < rows.length) {
      const rowRect = rows[idx].getBoundingClientRect();
      indicator.style.top = `${rowRect.top - wrapperRect.top}px`;
      indicator.style.height = `${rowRect.height}px`;
    }
  });
}

// ─── Main NodeView ──────────────────────────────────────────

export const tableNodeView: NodeViewFactory = (node, view, getPos) => {
  // Outer wrapper
  const dom = document.createElement('div');
  dom.classList.add('table-block-wrapper');

  // Scroll container
  const scroll = document.createElement('div');
  scroll.classList.add('table-block__scroll');
  dom.appendChild(scroll);

  // Table element
  const table = document.createElement('table');
  table.classList.add('pm-table');
  scroll.appendChild(table);

  // colgroup for column resizing
  const colgroup = document.createElement('colgroup');
  table.appendChild(colgroup);

  // tbody = contentDOM
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);

  // Initialize colgroup from node data
  const cellMinWidth = 80;
  updateColumnsOnResize(node, colgroup, table, cellMinWidth);

  // +Column button (right side)
  const addColBtn = document.createElement('button');
  addColBtn.classList.add('table-block__add-col-btn');
  addColBtn.setAttribute('contenteditable', 'false');
  addColBtn.textContent = '+';
  addColBtn.title = 'Add column';
  addColBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = getPos();
    if (pos == null) return;
    const tableNode = view.state.doc.nodeAt(pos);
    if (!tableNode) return;
    const firstRow = tableNode.child(0);
    selectCell(view, pos, 0, firstRow.childCount - 1);
    addColumnAfter(view.state, view.dispatch);
  });
  dom.appendChild(addColBtn);

  // +Row button (bottom)
  const addRowBtn = document.createElement('button');
  addRowBtn.classList.add('table-block__add-row-btn');
  addRowBtn.setAttribute('contenteditable', 'false');
  addRowBtn.textContent = '+';
  addRowBtn.title = 'Add row';
  addRowBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = getPos();
    if (pos == null) return;
    const tableNode = view.state.doc.nodeAt(pos);
    if (!tableNode) return;
    selectCell(view, pos, tableNode.childCount - 1, 0);
    addRowAfter(view.state, view.dispatch);
  });
  dom.appendChild(addRowBtn);

  // ─── Build indicators after DOM is ready ─────────

  let rafId: number | null = null;

  function rebuildIndicators() {
    buildColumnIndicators(dom, table, view, getPos);
    buildRowIndicators(dom, table, view, getPos);
    schedulePositionUpdate();
  }

  function schedulePositionUpdate() {
    if (rafId != null) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      updateIndicatorPositions(dom, table);
      rafId = null;
    });
  }

  // Build indicators after initial render
  setTimeout(rebuildIndicators, 50);

  return {
    dom,
    contentDOM: tbody,
    ignoreMutation(mutation) {
      return !tbody.contains(mutation.target);
    },
    update(updatedNode) {
      if (updatedNode.type !== node.type) return false;
      node = updatedNode;
      // Sync colgroup with column widths
      updateColumnsOnResize(node, colgroup, table, cellMinWidth);
      // Rebuild indicators when table structure changes
      setTimeout(rebuildIndicators, 30);
      return true;
    },
    destroy() {
      if (rafId != null) cancelAnimationFrame(rafId);
    },
  };
};
