import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { Decoration, DecorationSet } from 'prosemirror-view';

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

/** P1: 视觉缩进（indent attr）— 对任何有 indent attr 的 block 生效 */
function indentBlock(view: EditorView): boolean {
  const { $from } = view.state.selection;
  if ($from.depth < 1) return false;

  // 找到顶层 block（depth=1），对整个 block 缩进
  const pos = $from.before(1);
  const node = $from.node(1);
  if (!node || node.attrs.indent === undefined) return false;

  const currentIndent = node.attrs.indent || 0;
  if (currentIndent >= MAX_INDENT) return true;
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    indent: currentIndent + 1,
  }));
  return true;
}

/** P1: 反缩进 */
function outdentBlock(view: EditorView): boolean {
  const { $from } = view.state.selection;
  if ($from.depth < 1) return false;

  const pos = $from.before(1);
  const node = $from.node(1);
  if (!node || node.attrs.indent === undefined) return false;

  const currentIndent = node.attrs.indent || 0;
  if (currentIndent <= 0) return false;
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    indent: currentIndent - 1,
  }));
  return true;
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

  const listType = state.schema.nodes[listInfo.listType];
  if (!listType) return false;

  const tr = state.tr;
  const isTaskList = listInfo.listType === 'taskList';

  if (prevChild.type.name === listInfo.listType) {
    // 上一个兄弟是同类型列表 → 追加到它末尾
    const appendPos = prevChildPos + prevChild.nodeSize - 1;
    tr.delete(currentChildPos, currentChildEnd);
    tr.insert(tr.mapping.map(appendPos), currentChild);
  } else if (isTaskList && prevChild.type.name === 'taskItem') {
    // taskList: prevChild 是 taskItem → 在 taskItem 内部末尾插入嵌套 taskList
    // 检查 prevChild 内是否已有嵌套 taskList
    let existingNestedPos = -1;
    prevChild.forEach((child, offset) => {
      if (child.type.name === 'taskList') {
        existingNestedPos = prevChildPos + 1 + offset;
      }
    });
    tr.delete(currentChildPos, currentChildEnd);
    if (existingNestedPos >= 0) {
      // 已有嵌套 taskList → 追加到末尾
      const nestedList = state.doc.nodeAt(existingNestedPos)!;
      tr.insert(tr.mapping.map(existingNestedPos + nestedList.nodeSize - 1), currentChild);
    } else {
      // 没有嵌套 → 在 taskItem 内部末尾创建嵌套 taskList
      const nestedList = listType.create(null, [currentChild]);
      tr.insert(tr.mapping.map(prevChildPos + prevChild.nodeSize - 1), nestedList);
    }
  } else {
    // 普通 block → 创建新子列表，插入在 prevChild 之后
    const nestedList = listType.create(null, [currentChild]);
    tr.delete(currentChildPos, currentChildEnd);
    tr.insert(tr.mapping.map(prevChildPos + prevChild.nodeSize), nestedList);
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
      // 为所有有 indent > 0 的顶层 block 添加 padding-left 装饰
      decorations(state) {
        const decos: Decoration[] = [];
        state.doc.forEach((node, pos) => {
          const indent = node.attrs.indent;
          if (indent && indent > 0) {
            decos.push(Decoration.node(pos, pos + node.nodeSize, {
              style: `margin-left: ${indent * 24}px`,
            }));
          }
        });
        return decos.length > 0 ? DecorationSet.create(state.doc, decos) : DecorationSet.empty;
      },

      handleKeyDown(view, event) {
        if (event.key !== 'Tab') return false;

        const { $from } = view.state.selection;

        // 在 tableCell / tableHeader 内 → 让 tableKeymapPlugin 接管（跳 cell / 加行）
        for (let d = $from.depth; d > 0; d--) {
          const name = $from.node(d).type.name;
          if (name === 'tableCell' || name === 'tableHeader') return false;
          if (name === 'table') break;
        }

        // codeBlock 有自己的 Tab 处理（插入空格），这里跳过
        if ($from.parent.type.spec.code) return false;

        event.preventDefault();
        const listInfo = isInList(view, $from.pos);

        if (event.shiftKey) {
          // Shift+Tab
          if (listInfo) {
            // 在嵌套列表中 → 尝试提升
            if (liftListItem(view)) return true;
            // 不在嵌套中 → 不做任何事（列表内不支持视觉缩进）
            return true;
          }
          return outdentBlock(view);
        } else {
          // Tab
          if (listInfo) {
            // 列表内 → 尝试嵌套
            if (nestListItem(view, listInfo)) return true;
            // 嵌套失败（如第一项）→ 不做任何事（列表内不支持视觉缩进）
            return true;
          }
          return indentBlock(view);
        }
      },
    },
  });
}
