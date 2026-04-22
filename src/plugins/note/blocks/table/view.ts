/**
 * table/view.ts — Table NodeView
 *
 * Layout (outer .table-block-wrapper):
 *   ├── .table-block__col-indicators   hover 显示的列指示器条（顶部）
 *   ├── .table-block__row-indicators   hover 显示的行指示器条（左侧）
 *   ├── .table-block__scroll  →  <table><colgroup/><tbody=contentDOM/>
 *   ├── button.table-block__add-col-btn   +col（右侧）
 *   └── button.table-block__add-row-btn   +row（底部）
 *
 * 指示器点击 → 先把光标定位到对应行/列的首 cell → 弹出上下文菜单。
 * 菜单是原生 DOM（contenteditable="false"），不走 React，保持和其他 blocks 风格一致。
 */

import type { Node as PMNode } from 'prosemirror-model';
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  updateColumnsOnResize,
} from 'prosemirror-tables';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { NodeViewFactory } from '../../types';
import { duplicateColumn, duplicateRow } from './commands';

// ─── Helper: place cursor into a specific cell ─────────────

function selectCell(view: EditorView, tablePos: number, rowIdx: number, colIdx: number): boolean {
  const tableNode = view.state.doc.nodeAt(tablePos);
  if (!tableNode) return false;

  let rowStart = tablePos + 1;
  for (let r = 0; r < rowIdx; r++) {
    rowStart += tableNode.child(r).nodeSize;
  }

  const row = tableNode.child(rowIdx);
  let cellStart = rowStart + 1;
  for (let c = 0; c < colIdx; c++) {
    cellStart += row.child(c).nodeSize;
  }

  const insideCell = cellStart + 1;
  try {
    const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, insideCell));
    view.dispatch(tr);
    return true;
  } catch {
    return false;
  }
}

// ─── Context menu (simple DOM popover) ─────────────────────

interface MenuItem {
  label: string;
  icon?: string;
  danger?: boolean;
  run: () => void;
}

let currentMenu: HTMLElement | null = null;

function closeMenu() {
  if (currentMenu && currentMenu.parentNode) currentMenu.parentNode.removeChild(currentMenu);
  currentMenu = null;
  document.removeEventListener('mousedown', closeOnOutside, true);
}

function closeOnOutside(e: MouseEvent) {
  if (currentMenu && !currentMenu.contains(e.target as Node)) closeMenu();
}

function openMenu(anchor: HTMLElement, items: MenuItem[]) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'table-block__menu';
  menu.setAttribute('contenteditable', 'false');

  for (const item of items) {
    const btn = document.createElement('button');
    btn.className = 'table-block__menu-item' + (item.danger ? ' is-danger' : '');
    btn.setAttribute('contenteditable', 'false');
    if (item.icon) {
      const icon = document.createElement('span');
      icon.className = 'table-block__menu-icon';
      icon.textContent = item.icon;
      btn.appendChild(icon);
    }
    const label = document.createElement('span');
    label.textContent = item.label;
    btn.appendChild(label);
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      item.run();
      closeMenu();
    });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);
  currentMenu = menu;

  const r = anchor.getBoundingClientRect();
  menu.style.top = `${r.bottom + 4}px`;
  menu.style.left = `${r.left}px`;

  const mr = menu.getBoundingClientRect();
  if (mr.right > window.innerWidth - 8) {
    menu.style.left = `${Math.max(8, window.innerWidth - mr.width - 8)}px`;
  }

  setTimeout(() => document.addEventListener('mousedown', closeOnOutside, true), 0);
}

// ─── Indicators ─────────────────────────────────────────────

function rebuildIndicators(
  view: EditorView,
  getPos: () => number | undefined,
  scroll: HTMLElement,
  table: HTMLTableElement,
  colBar: HTMLElement,
  rowBar: HTMLElement,
) {
  colBar.innerHTML = '';
  rowBar.innerHTML = '';

  const tbody = table.querySelector('tbody');
  if (!tbody) return;
  const rows = Array.from(tbody.querySelectorAll(':scope > tr'));
  if (rows.length === 0) return;

  const scrollRect = scroll.getBoundingClientRect();
  const firstRow = rows[0] as HTMLTableRowElement;
  const cols = Array.from(firstRow.querySelectorAll(':scope > td, :scope > th'));

  // —— 列指示器 —— (colBar 与 scroll 顶部对齐)
  cols.forEach((cellEl, colIdx) => {
    const rect = (cellEl as HTMLElement).getBoundingClientRect();

    const ind = document.createElement('div');
    ind.className = 'table-block__col-indicator';
    ind.setAttribute('contenteditable', 'false');
    ind.style.left = `${rect.left - scrollRect.left}px`;
    ind.style.width = `${rect.width}px`;
    const dot = document.createElement('span');
    dot.className = 'table-block__indicator-dot';
    dot.textContent = '⋯';
    ind.appendChild(dot);

    ind.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = getPos();
      if (pos == null) return;
      selectCell(view, pos, 0, colIdx);
      openColumnMenu(ind, view);
    });
    colBar.appendChild(ind);
  });

  // —— 行指示器 —— (rowBar 与 scroll 左侧对齐)
  rows.forEach((rowEl, rowIdx) => {
    const rect = (rowEl as HTMLElement).getBoundingClientRect();

    const ind = document.createElement('div');
    ind.className = 'table-block__row-indicator';
    ind.setAttribute('contenteditable', 'false');
    ind.style.top = `${rect.top - scrollRect.top}px`;
    ind.style.height = `${rect.height}px`;
    const dot = document.createElement('span');
    dot.className = 'table-block__indicator-dot';
    dot.textContent = '⋯';
    ind.appendChild(dot);

    ind.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = getPos();
      if (pos == null) return;
      selectCell(view, pos, rowIdx, 0);
      openRowMenu(ind, view);
    });
    rowBar.appendChild(ind);
  });
}

function openColumnMenu(anchor: HTMLElement, view: EditorView) {
  const run = (cmd: (s: any, d: any) => boolean) => () => {
    cmd(view.state, view.dispatch);
    view.focus();
  };
  openMenu(anchor, [
    { label: '向左插入列', icon: '←', run: run(addColumnBefore) },
    { label: '向右插入列', icon: '→', run: run(addColumnAfter) },
    { label: '复制列',     icon: '⧉', run: run(duplicateColumn) },
    { label: '删除列',     icon: '🗑', danger: true, run: run(deleteColumn) },
  ]);
}

function openRowMenu(anchor: HTMLElement, view: EditorView) {
  const run = (cmd: (s: any, d: any) => boolean) => () => {
    cmd(view.state, view.dispatch);
    view.focus();
  };
  openMenu(anchor, [
    { label: '向上插入行', icon: '↑', run: run(addRowBefore) },
    { label: '向下插入行', icon: '↓', run: run(addRowAfter) },
    { label: '复制行',     icon: '⧉', run: run(duplicateRow) },
    { label: '删除行',     icon: '🗑', danger: true, run: run(deleteRow) },
  ]);
}

// ─── Main NodeView ──────────────────────────────────────────

export const tableNodeView: NodeViewFactory = (node, view, getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('table-block-wrapper');

  // 指示器条（hover 显示）——放在 scroll 之前，绝对定位
  const colBar = document.createElement('div');
  colBar.className = 'table-block__col-indicators';
  colBar.setAttribute('contenteditable', 'false');
  dom.appendChild(colBar);

  const rowBar = document.createElement('div');
  rowBar.className = 'table-block__row-indicators';
  rowBar.setAttribute('contenteditable', 'false');
  dom.appendChild(rowBar);

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

  const cellMinWidth = 80;
  updateColumnsOnResize(node, colgroup, table, cellMinWidth);

  // +Column button (right)
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

  const scheduleRebuild = () => {
    requestAnimationFrame(() => rebuildIndicators(view, getPos, scroll, table, colBar, rowBar));
  };
  scheduleRebuild();

  // 监听滚动和 resize 重建（位置会变）
  scroll.addEventListener('scroll', scheduleRebuild);
  const ro = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(scheduleRebuild)
    : null;
  if (ro) ro.observe(table);

  return {
    dom,
    contentDOM: tbody,
    ignoreMutation(mutation) {
      return !tbody.contains(mutation.target);
    },
    update(updatedNode) {
      if (updatedNode.type !== node.type) return false;
      node = updatedNode;
      updateColumnsOnResize(node, colgroup, table, cellMinWidth);
      scheduleRebuild();
      return true;
    },
    destroy() {
      closeMenu();
      scroll.removeEventListener('scroll', scheduleRebuild);
      if (ro) ro.disconnect();
    },
  };
};
