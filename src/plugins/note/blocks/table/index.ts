/**
 * table/ — Table 节点模块
 *
 * 统一导出 NodeView 和 Commands
 */

export { tableNodeView } from './view';
export { insertTable, duplicateRow, duplicateColumn, duplicateSelectedCells } from './commands';
export { tableToolbarPlugin } from './toolbar';
