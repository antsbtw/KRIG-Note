/**
 * table/commands.ts — Table 专有命令
 *
 * insertTable, duplicateRow, duplicateColumn, duplicateSelectedCells
 */

import { TextSelection, type Command } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { selectedRect, CellSelection } from 'prosemirror-tables';

// ─── Helper: find nearest block-level node ──────────────────

function findNearestBlock($pos: any): { pos: number; node: PMNode } {
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.spec.group === 'block' || d === 1) {
      return { pos: $pos.before(d), node };
    }
  }
  return { pos: $pos.before(1), node: $pos.node(1) };
}

// ─── Insert Table ───────────────────────────────────────────

/** Insert a table with the given number of rows and columns */
export function insertTable(rows = 3, cols = 3): Command {
  return (state, dispatch) => {
    const schema = state.schema;
    if (!schema.nodes.table) return false;

    if (dispatch) {
      const { pos: blockStart, node: blockNode } = findNearestBlock(state.selection.$from);
      const blockEnd = blockStart + blockNode.nodeSize;

      // First row uses tableHeader, rest use tableCell
      const headerCells = Array.from({ length: cols }, () =>
        schema.nodes.tableHeader.create(null, [schema.nodes.textBlock.create()]));
      const headerRow = schema.nodes.tableRow.create(null, headerCells);

      const bodyRows = Array.from({ length: rows - 1 }, () => {
        const cells = Array.from({ length: cols }, () =>
          schema.nodes.tableCell.create(null, [schema.nodes.textBlock.create()]));
        return schema.nodes.tableRow.create(null, cells);
      });

      const table = schema.nodes.table.create(null, [headerRow, ...bodyRows]);
      const tr = state.tr.replaceWith(blockStart, blockEnd, table);

      // Place cursor in the first header cell
      try { tr.setSelection(TextSelection.create(tr.doc, blockStart + 4)); } catch { /* ignore */ }
      dispatch(tr);
    }
    return true;
  };
}

// ─── Duplicate Row ──────────────────────────────────────────

/** Duplicate the row containing the current selection and insert it below */
export const duplicateRow: Command = (state, dispatch) => {
  const rect = (() => { try { return selectedRect(state); } catch { return null; } })();
  if (!rect) return false;

  const schema = state.schema;
  const { table, tableStart, map } = rect;

  // Determine which row to duplicate
  const sel = state.selection;
  let rowIdx = -1;
  if (sel instanceof CellSelection) {
    const cellRect = map.findCell(sel.$anchorCell.pos - tableStart);
    rowIdx = cellRect.top;
  } else {
    const $from = sel.$from;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === 'tableRow') {
        rowIdx = $from.index(d - 1);
        break;
      }
    }
    if (rowIdx < 0) return false;
  }

  if (dispatch) {
    const row = table.child(rowIdx);
    const copiedCells: PMNode[] = [];
    row.forEach(cell => {
      const cellType = cell.type.name === 'tableHeader' ? schema.nodes.tableHeader : schema.nodes.tableCell;
      copiedCells.push(cellType.create(cell.attrs, cell.content, cell.marks));
    });
    const newRow = schema.nodes.tableRow.create(null, copiedCells);

    // Insert after the current row
    let insertPos = tableStart;
    for (let r = 0; r <= rowIdx; r++) {
      insertPos += table.child(r).nodeSize;
    }
    dispatch(state.tr.insert(insertPos, newRow));
  }
  return true;
};

// ─── Duplicate Column ───────────────────────────────────────

/** Duplicate the column containing the current selection and insert it to the right */
export const duplicateColumn: Command = (state, dispatch) => {
  const rect = (() => { try { return selectedRect(state); } catch { return null; } })();
  if (!rect) return false;

  const schema = state.schema;
  const { table, tableStart, map } = rect;

  // Determine which column to duplicate
  const sel = state.selection;
  let colIdx = -1;
  if (sel instanceof CellSelection) {
    const cellRect = map.findCell(sel.$anchorCell.pos - tableStart);
    colIdx = cellRect.left;
  } else {
    const $from = sel.$from;
    for (let d = $from.depth; d > 0; d--) {
      const nodeType = $from.node(d).type.name;
      if (nodeType === 'tableCell' || nodeType === 'tableHeader') {
        colIdx = $from.index(d - 1);
        break;
      }
    }
    if (colIdx < 0) return false;
  }

  if (dispatch) {
    let tr = state.tr;
    // Process rows bottom-to-top so positions stay valid
    for (let r = table.childCount - 1; r >= 0; r--) {
      const row = table.child(r);
      if (colIdx >= row.childCount) continue;

      const cell = row.child(colIdx);
      const cellType = cell.type.name === 'tableHeader' ? schema.nodes.tableHeader : schema.nodes.tableCell;
      const newCell = cellType.create(
        { ...cell.attrs, colwidth: null },
        cell.content,
        cell.marks,
      );

      // Find insert position: after colIdx cell in this row
      let rowStart = tableStart;
      for (let ri = 0; ri < r; ri++) rowStart += table.child(ri).nodeSize;
      let cellPos = rowStart + 1; // +1 to enter row
      for (let ci = 0; ci <= colIdx; ci++) cellPos += row.child(ci).nodeSize;

      tr = tr.insert(tr.mapping.map(cellPos), newCell);
    }
    dispatch(tr);
  }
  return true;
};

// ─── Duplicate Selected Cells ───────────────────────────────

/** Duplicate the selected cell rectangle and insert it as new rows below the selection */
export const duplicateSelectedCells: Command = (state, dispatch) => {
  const sel = state.selection;
  if (!(sel instanceof CellSelection)) return false;

  const rect = (() => { try { return selectedRect(state); } catch { return null; } })();
  if (!rect) return false;

  const schema = state.schema;
  const { table, tableStart, map } = rect;

  // Get the selected rectangle bounds
  const selRect = map.rectBetween(
    sel.$anchorCell.pos - tableStart,
    sel.$headCell.pos - tableStart,
  );

  if (dispatch) {
    const newRows: PMNode[] = [];
    const totalCols = map.width;

    for (let r = selRect.top; r < selRect.bottom; r++) {
      const cells: PMNode[] = [];
      for (let c = 0; c < totalCols; c++) {
        if (c >= selRect.left && c < selRect.right) {
          // Copy the selected cell
          const cellPos = map.map[r * map.width + c];
          const cell = table.nodeAt(cellPos);
          if (cell) {
            cells.push(schema.nodes.tableCell.create(
              { colspan: cell.attrs.colspan, rowspan: cell.attrs.rowspan, colwidth: null },
              cell.content,
              cell.marks,
            ));
          }
        } else {
          // Fill with empty cell
          cells.push(schema.nodes.tableCell.create(null, [schema.nodes.textBlock.create()]));
        }
      }
      newRows.push(schema.nodes.tableRow.create(null, cells));
    }

    // Insert after the bottom row of selection
    let insertPos = tableStart;
    for (let r = 0; r < selRect.bottom; r++) {
      insertPos += table.child(r).nodeSize;
    }
    dispatch(state.tr.insert(insertPos, newRows));
  }
  return true;
};
