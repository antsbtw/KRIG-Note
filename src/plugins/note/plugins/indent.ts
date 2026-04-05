import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

/**
 * Indent Plugin — Tab/Shift+Tab 缩进系统
 *
 * P1: 普通 block 视觉缩进（indent attr 0-8）
 * P2: 列表嵌套缩进（Tab → 同类型子列表）
 *
 * Tab 语义由上下文决定：
 * - 列表内 → 嵌套（P2）
 * - 其他 → 视觉缩进（P1）
 */

const MAX_INDENT = 8;

/** 计算 node 第 index 个子节点的 offset */
function childOffset(node: import('prosemirror-model').Node, index: number): number {
  let offset = 0;
  for (let i = 0; i < index; i++) {
    offset += node.child(i).nodeSize;
  }
  return offset;
}

/** 列表容器类型 */
const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);

/** 判断 pos 是否在列表内 */
function isInList(view: EditorView, pos: number): { listPos: number; listType: string } | null {
  const $pos = view.state.doc.resolve(pos);
  for (let d = $pos.depth; d >= 1; d--) {
    const node = $pos.node(d);
    if (LIST_TYPES.has(node.type.name)) {
      return { listPos: $pos.before(d), listType: node.type.name };
    }
  }
  return null;
}

/** P1: 视觉缩进（indent attr） */
function indentBlock(view: EditorView): boolean {
  const { $from } = view.state.selection;
  if ($from.depth < 1) return false;

  // 找到当前所在的 block（可能在 Container 内部）
  let depth = $from.depth;
  while (depth > 0) {
    const node = $from.node(depth);
    if (node.type.name === 'textBlock' && node.attrs.indent !== undefined) {
      const pos = $from.before(depth);
      const currentIndent = node.attrs.indent || 0;
      if (currentIndent >= MAX_INDENT) return true;
      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        indent: currentIndent + 1,
      }));
      return true;
    }
    depth--;
  }
  return false;
}

/** P1: 反缩进 */
function outdentBlock(view: EditorView): boolean {
  const { $from } = view.state.selection;
  if ($from.depth < 1) return false;

  let depth = $from.depth;
  while (depth > 0) {
    const node = $pos_node(view, $from, depth);
    if (node.type.name === 'textBlock' && node.attrs.indent !== undefined) {
      const pos = $from.before(depth);
      const currentIndent = node.attrs.indent || 0;
      if (currentIndent <= 0) return false; // 不拦截，让 ProseMirror 处理
      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        indent: currentIndent - 1,
      }));
      return true;
    }
    depth--;
  }
  return false;
}

function $pos_node(view: EditorView, $from: any, depth: number) {
  return $from.node(depth);
}

/** P2: 列表嵌套（将当前项包裹进同类型子列表） */
function nestListItem(view: EditorView, listInfo: { listPos: number; listType: string }): boolean {
  const { state } = view;
  const listNode = state.doc.nodeAt(listInfo.listPos);
  if (!listNode) return false;

  // 找到光标所在的直接子 block 在列表中的 index
  const { $from } = state.selection;
  let childIndex = -1;
  let childPos = listInfo.listPos + 1; // 列表内第一个子节点的位置

  // 对于 taskList，子节点是 taskItem；对于 bulletList/orderedList，子节点是 block
  for (let i = 0; i < listNode.childCount; i++) {
    const child = listNode.child(i);
    if ($from.pos >= childPos && $from.pos < childPos + child.nodeSize) {
      childIndex = i;
      break;
    }
    childPos += child.nodeSize;
  }

  // 第一项不能嵌套（没有上一个兄弟来合并）
  if (childIndex <= 0) return false;

  // 获取当前子节点
  const currentChild = listNode.child(childIndex);
  const currentChildPos = listInfo.listPos + 1 + childOffset(listNode, childIndex);
  const currentChildEnd = currentChildPos + currentChild.nodeSize;

  // 获取上一个兄弟
  const prevChild = listNode.child(childIndex - 1);
  const prevChildPos = listInfo.listPos + 1 + childOffset(listNode, childIndex - 1);

  // 检查上一个兄弟是否已有同类型子列表（合并进去）
  const listType = state.schema.nodes[listInfo.listType];
  if (!listType) return false;

  // 检查 prevChild 内部是否已有嵌套列表
  let existingNestedList = false;
  let nestedListPos = -1;
  if (prevChild.type.name === 'taskItem' || LIST_TYPES.has(prevChild.type.name)) {
    // taskItem 或列表容器内可能有嵌套列表
    prevChild.forEach((child, offset) => {
      if (child.type.name === listInfo.listType) {
        existingNestedList = true;
        nestedListPos = prevChildPos + 1 + offset;
      }
    });
  }

  const tr = state.tr;

  if (existingNestedList && nestedListPos >= 0) {
    // 合并：将当前项移入已有的嵌套列表末尾
    const nestedList = state.doc.nodeAt(nestedListPos);
    if (!nestedList) return false;
    const insertPos = nestedListPos + nestedList.nodeSize - 1;

    // 先删除当前项
    tr.delete(currentChildPos, currentChildEnd);
    // 映射后插入
    const mappedInsert = tr.mapping.map(insertPos);
    tr.insert(mappedInsert, currentChild);
  } else {
    // 创建新的嵌套列表
    const nestedList = listType.create(null, [currentChild]);
    // 删除当前项
    tr.delete(currentChildPos, currentChildEnd);
    // 在上一个兄弟末尾插入嵌套列表
    const mappedPrevEnd = tr.mapping.map(prevChildPos + prevChild.nodeSize);
    tr.insert(mappedPrevEnd - 1, nestedList);
  }

  view.dispatch(tr);
  return true;
}

/** P3: 列表提升（从子列表提取到父列表） */
function liftListItem(view: EditorView): boolean {
  const { state } = view;
  const { $from } = state.selection;

  // 找到光标所在的列表，以及它的父列表
  let innerListDepth = -1;
  for (let d = $from.depth; d >= 1; d--) {
    if (LIST_TYPES.has($from.node(d).type.name)) {
      innerListDepth = d;
      break;
    }
  }
  if (innerListDepth < 1) return false;

  // 检查是否有父列表（嵌套至少两层）
  let outerListDepth = -1;
  for (let d = innerListDepth - 1; d >= 1; d--) {
    if (LIST_TYPES.has($from.node(d).type.name)) {
      outerListDepth = d;
      break;
    }
  }
  // 也检查父是否是 taskItem（taskList > taskItem > taskList）
  if (outerListDepth < 0) {
    for (let d = innerListDepth - 1; d >= 1; d--) {
      if ($from.node(d).type.name === 'taskItem') {
        // taskItem 的父应该是 taskList
        if (d > 1 && LIST_TYPES.has($from.node(d - 1).type.name)) {
          outerListDepth = d - 1;
          break;
        }
      }
    }
  }

  if (outerListDepth < 0) return false; // 不在嵌套列表中

  // 找到当前项在内层列表中的位置
  const innerListPos = $from.before(innerListDepth);
  const innerListNode = $from.node(innerListDepth);

  let childIndex = -1;
  let childPos = innerListPos + 1;
  for (let i = 0; i < innerListNode.childCount; i++) {
    const child = innerListNode.child(i);
    if ($from.pos >= childPos && $from.pos < childPos + child.nodeSize) {
      childIndex = i;
      break;
    }
    childPos += child.nodeSize;
  }
  if (childIndex < 0) return false;

  const currentChild = innerListNode.child(childIndex);
  const currentChildPos = innerListPos + 1 + childOffset(innerListNode, childIndex);
  const currentChildEnd = currentChildPos + currentChild.nodeSize;

  // 将当前项从内层列表删除，插入到外层列表（内层列表的后面）
  const innerListEnd = innerListPos + innerListNode.nodeSize;

  const tr = state.tr;
  tr.delete(currentChildPos, currentChildEnd);

  // 如果内层列表变空了，删除它
  const mappedInnerPos = tr.mapping.map(innerListPos);
  const updatedInnerList = tr.doc.nodeAt(mappedInnerPos);
  if (updatedInnerList && updatedInnerList.childCount === 0) {
    tr.delete(mappedInnerPos, mappedInnerPos + updatedInnerList.nodeSize);
  }

  // 插入到外层列表中（内层列表之后的位置）
  const mappedInsertPos = tr.mapping.map(innerListEnd);
  tr.insert(mappedInsertPos, currentChild);

  view.dispatch(tr);
  return true;
}

export function indentPlugin(): Plugin {
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (event.key !== 'Tab') return false;
        event.preventDefault();

        const { $from } = view.state.selection;
        const listInfo = isInList(view, $from.pos);

        if (event.shiftKey) {
          // Shift+Tab
          if (listInfo) {
            // 在嵌套列表中 → 尝试提升
            if (liftListItem(view)) return true;
            // 不在嵌套中 → 视觉反缩进
            return outdentBlock(view);
          }
          return outdentBlock(view);
        } else {
          // Tab
          if (listInfo) {
            // 列表内 → 尝试嵌套
            if (nestListItem(view, listInfo)) return true;
            // 嵌套失败（如第一项）→ 视觉缩进
            return indentBlock(view);
          }
          return indentBlock(view);
        }
      },
    },
  });
}
