/**
 * table/view.ts — Table NodeView
 *
 * Renders a table with:
 * - +row / +col buttons on hover (bottom / right)
 * contentDOM = tbody, so ProseMirror manages rows/cells inside.
 */

import type { Node as PMNode } from 'prosemirror-model';
import {
  addColumnAfter,
  addRowAfter,
  updateColumnsOnResize,
} from 'prosemirror-tables';
import { TextSelection } from 'prosemirror-state';
import type { NodeViewFactory } from '../../types';

// ─── Helper: place cursor into a specific cell ─────────────

function selectCell(view: import('prosemirror-view').EditorView, tablePos: number, rowIdx: number, colIdx: number): boolean {
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
      return true;
    },
  };
};
