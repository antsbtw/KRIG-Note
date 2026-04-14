import { Plugin } from 'prosemirror-state';
import { Fragment } from 'prosemirror-model';
import type { Node as PMNode } from 'prosemirror-model';

/**
 * Column Collapse Plugin — 空 column 自动收缩
 *
 * appendTransaction 后处理（仅在 column 由非空变空时触发）：
 * - column 只剩一个空 textBlock 且之前有内容 → 移除该 column，剩余 column 扩展
 * - columnList 只剩 1 个 column → 解散 columnList，子节点平铺到顶层
 */

function isEmptyColumn(column: PMNode): boolean {
  if (column.type.name !== 'column') return false;
  if (column.childCount !== 1) return false;
  const child = column.child(0);
  return child.type.name === 'textBlock' && child.content.size === 0;
}

export function columnCollapsePlugin(): Plugin {
  return new Plugin({
    appendTransaction(_transactions, oldState, newState) {
      if (oldState.doc.eq(newState.doc)) return null;

      // 收集 oldState 中每个 columnList 内各 column 的空/非空状态
      const oldColumnStates = new Map<number, boolean[]>();
      oldState.doc.forEach((node, offset) => {
        if (node.type.name === 'columnList') {
          const states: boolean[] = [];
          for (let c = 0; c < node.childCount; c++) {
            states.push(isEmptyColumn(node.child(c)));
          }
          oldColumnStates.set(offset, states);
        }
      });

      const { doc } = newState;
      let tr = newState.tr;
      let changed = false;

      // 从后往前遍历，避免位置偏移
      const topNodes: { node: PMNode; pos: number }[] = [];
      doc.forEach((node, offset) => {
        if (node.type.name === 'columnList') {
          topNodes.push({ node, pos: offset });
        }
      });

      for (let i = topNodes.length - 1; i >= 0; i--) {
        const { node: columnList, pos: clPos } = topNodes[i];

        // 找到 oldState 中对应的 columnList
        const oldStates = oldColumnStates.get(clPos);

        // 检查是否有 column 从非空变为空（"新变空"）
        const newlyEmptyIndices: number[] = [];
        for (let c = 0; c < columnList.childCount; c++) {
          if (!isEmptyColumn(columnList.child(c))) continue;
          // 如果 oldState 中这个 column 不存在或不为空 → 是新变空的
          const wasEmpty = oldStates && c < oldStates.length ? oldStates[c] : true;
          if (!wasEmpty) {
            newlyEmptyIndices.push(c);
          }
        }

        if (newlyEmptyIndices.length === 0) continue;

        // 计算非空 column 数量
        const nonEmptyColumns: { col: PMNode; index: number }[] = [];
        for (let c = 0; c < columnList.childCount; c++) {
          if (!isEmptyColumn(columnList.child(c))) {
            nonEmptyColumns.push({ col: columnList.child(c), index: c });
          }
        }

        const mappedPos = tr.mapping.map(clPos);
        const mappedNode = tr.doc.nodeAt(mappedPos);
        if (!mappedNode) continue;

        if (nonEmptyColumns.length === 0) {
          // 所有 column 都空了 → 替换为一个空 textBlock
          const newBlock = newState.schema.nodes.textBlock.create();
          tr = tr.replaceWith(mappedPos, mappedPos + mappedNode.nodeSize, newBlock);
          changed = true;
        } else if (nonEmptyColumns.length === 1) {
          // 只剩 1 个非空 column → 解散 columnList，子节点平铺
          tr = tr.replaceWith(mappedPos, mappedPos + mappedNode.nodeSize, nonEmptyColumns[0].col.content);
          changed = true;
        } else {
          // 还剩 2+ 个非空 column → 移除空 column，重置宽度
          const kept = nonEmptyColumns.map(({ col }) =>
            col.type.create({ ...col.attrs, width: null }, col.content),
          );
          const newColumnList = mappedNode.type.create(
            { ...mappedNode.attrs, columns: kept.length },
            Fragment.from(kept),
          );
          tr = tr.replaceWith(mappedPos, mappedPos + mappedNode.nodeSize, newColumnList);
          changed = true;
        }
      }

      if (!changed) return null;
      tr.setMeta('addToHistory', false);
      return tr;
    },
  });
}
