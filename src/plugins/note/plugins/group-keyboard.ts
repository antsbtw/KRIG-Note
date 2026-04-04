/**
 * Group Keyboard Plugin — groupType 的键盘行为
 *
 * Enter: 新 Block 继承 groupType + indent + groupAttrs
 *        空行 + Enter → 退回父级 groupType（或清除变普通段落）
 * Backspace: 行首 + 有 groupType → 清除 groupType
 * Tab/Shift-Tab: indent 调整（已在 NoteEditor 中处理）
 */

import { Plugin } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';

/**
 * 查找父级 groupType — 向上搜索 indent 更小的最近 block
 * 返回 { groupType, groupAttrs, indent } 或 null（退回普通段落）
 */
function findParentGroup(
  doc: PMNode,
  blockPos: number,
  currentIndent: number,
): { groupType: string; groupAttrs: Record<string, unknown> | null; indent: number } | null {
  if (currentIndent <= 0) return null;

  // 向前搜索 indent < currentIndent 的最近 textBlock
  let found: { groupType: string; groupAttrs: Record<string, unknown> | null; indent: number } | null = null;
  doc.forEach((node, pos) => {
    if (pos >= blockPos) return; // 只看当前 block 之前的
    if (node.type.name !== 'textBlock') return;
    const nodeIndent = (node.attrs.indent as number) || 0;
    if (nodeIndent < currentIndent && node.attrs.groupType) {
      found = {
        groupType: node.attrs.groupType as string,
        groupAttrs: node.attrs.groupAttrs ? { ...node.attrs.groupAttrs } : null,
        indent: nodeIndent,
      };
    }
  });
  return found;
}

export function groupKeyboardPlugin(): Plugin {
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        const { state } = view;
        const { $from, empty } = state.selection;

        // 只处理 textBlock
        const blockNode = $from.depth >= 1 ? $from.node($from.depth) : null;
        if (!blockNode || blockNode.type.name !== 'textBlock') return false;
        if (blockNode.attrs.isTitle) return false;

        const groupType = blockNode.attrs.groupType;
        if (!groupType) return false;

        // ── Enter ──
        if (event.key === 'Enter' && !event.shiftKey) {
          const blockPos = $from.before($from.depth);
          const isBlockEmpty = blockNode.content.size === 0;

          // 空行 + Enter → 退回父级 groupType（或清除变普通段落）
          if (isBlockEmpty) {
            const currentIndent = (blockNode.attrs.indent as number) || 0;
            const parent = findParentGroup(state.doc, blockPos, currentIndent);

            let newAttrs: Record<string, unknown>;
            if (parent) {
              // 有父级 → 退回父级 groupType + indent
              newAttrs = {
                ...blockNode.attrs,
                groupType: parent.groupType,
                groupAttrs: parent.groupAttrs,
                indent: parent.indent,
              };
            } else {
              // 无父级 → 清除 groupType，变普通段落
              newAttrs = {
                ...blockNode.attrs,
                groupType: null,
                groupAttrs: null,
                indent: 0,
              };
            }

            const tr = state.tr.setNodeMarkup(blockPos, undefined, newAttrs);
            tr.setMeta('groupTypeCleared', true);
            view.dispatch(tr);
            return true;
          }

          // 有内容 → 在光标位置分裂，新 Block 继承 groupType
          // ProseMirror 默认 split 会创建新节点，我们需要确保新节点继承 groupType
          // 不在这里处理分裂——让 ProseMirror 默认 split 执行，然后在 appendTransaction 中修复 attrs
          return false;
        }

        // ── Backspace（行首） ──
        if (event.key === 'Backspace') {
          const atStart = $from.parentOffset === 0;
          if (!atStart) return false;

          // 清除 groupType（变普通段落，保留文字）
          const blockPos = $from.before($from.depth);
          let newAttrs: Record<string, unknown> = { ...blockNode.attrs, groupType: null, groupAttrs: null };

          // task 特殊：清除 checked
          if (groupType === 'task') {
            newAttrs = { ...newAttrs };
          }

          const bsTr = state.tr.setNodeMarkup(blockPos, undefined, newAttrs);
          bsTr.setMeta('groupTypeCleared', true);
          view.dispatch(bsTr);
          return true;
        }

        return false;
      },
    },

    // appendTransaction: 确保 split 后的新 Block 继承 groupType
    appendTransaction(trs, oldState, newState) {
      // 只在 doc 变化时处理
      const tr = trs.find(t => t.docChanged && t.steps.length > 0);
      if (!tr) return null;

      // 如果是主动清除 groupType（空行 Enter / Backspace），不要恢复
      if (trs.some(t => t.getMeta('groupTypeCleared'))) return null;

      // 只在 split 操作后继承（block 数量增加了）
      if (newState.doc.childCount <= oldState.doc.childCount) return null;

      // 如果新 state 的光标所在 block 的 groupType 为 null，
      // 但上一个 block 有 groupType，说明是 split 后的新 block，需要继承
      const { $from } = newState.selection;
      if ($from.depth < 1) return null;
      const currNode = $from.node($from.depth);
      if (currNode.type.name !== 'textBlock') return null;
      if (currNode.attrs.groupType) return null; // 已经有 groupType
      if (currNode.attrs.isTitle) return null;

      const currPos = $from.before($from.depth);

      // 查找上一个 block
      if (currPos <= 0) return null;
      const $prev = newState.doc.resolve(currPos - 1);
      if ($prev.depth < 1) return null;
      const prevNode = $prev.node($prev.depth);
      if (prevNode.type.name !== 'textBlock') return null;

      const prevGroupType = prevNode.attrs.groupType;
      if (!prevGroupType) return null;

      // 继承 groupType + groupAttrs
      let inheritAttrs: Record<string, unknown> = {
        groupType: prevGroupType,
        groupAttrs: prevNode.attrs.groupAttrs ? { ...prevNode.attrs.groupAttrs } : null,
      };

      // task: 新 item 的 checked = false
      if (prevGroupType === 'task' && inheritAttrs.groupAttrs) {
        (inheritAttrs.groupAttrs as Record<string, unknown>).checked = false;
      }

      // toggle: 非首行不继承 open
      // （首行有 open 控制折叠，后续行不需要）

      return newState.tr.setNodeMarkup(currPos, undefined, {
        ...currNode.attrs,
        ...inheritAttrs,
      });
    },
  });
}
