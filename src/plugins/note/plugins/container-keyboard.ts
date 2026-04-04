import { Plugin } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import { blockRegistry } from '../registry';

/**
 * Container Keyboard Plugin — 所有 ContainerBlock 的统一键盘处理
 *
 * 一个插件、一套规则：
 *
 * Enter（有内容）→ 在 Container 内创建新 textBlock
 * Enter（空行）  → 退出 Container（移到容器后方）
 * Backspace（行首）→ 退出 Container（unwrap 当前行）
 *
 * 判断依据：光标所在 textBlock 的父节点是否是 Container（有 containerRule）
 */

export function containerKeyboardPlugin(): Plugin {
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        const { state } = view;
        const { $from } = state.selection;

        // 至少 depth=2 才可能在 Container 内（doc > Container > textBlock）
        if ($from.depth < 2) return false;

        const parentNode = $from.node($from.depth - 1);
        const parentDef = blockRegistry.get(parentNode.type.name);

        // 只处理有 containerRule 的父节点（= ContainerBlock）
        if (!parentDef?.containerRule) return false;

        const childNode = $from.parent; // 当前 textBlock
        const childDepth = $from.depth;
        const containerDepth = $from.depth - 1;

        // ── Enter ──
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();

          const isEmpty = childNode.content.size === 0;

          if (isEmpty) {
            // 空行 Enter → 退出 Container
            exitContainer(view, containerDepth, childDepth);
          } else {
            // 有内容 → 在 Container 内创建新 textBlock
            splitInContainer(view, childDepth);
          }
          return true;
        }

        // ── Backspace（行首） ──
        if (event.key === 'Backspace') {
          const atStart = $from.parentOffset === 0;
          if (!atStart) return false;

          // 如果是 Container 的第一个子节点 → 退出 Container
          const containerStart = $from.before(containerDepth);
          const childStart = $from.before(childDepth);
          const isFirstChild = childStart === containerStart + 1;

          if (isFirstChild) {
            event.preventDefault();
            unwrapFromContainer(view, containerDepth, childDepth);
            return true;
          }

          // 非首子 → 与上一个子节点合并（让 ProseMirror 默认处理）
          return false;
        }

        return false;
      },
    },
  });
}

/**
 * 退出 Container：删除空行，在容器后创建 textBlock
 * 如果容器变空，删除容器。
 */
function exitContainer(
  view: import('prosemirror-view').EditorView,
  containerDepth: number,
  childDepth: number,
): void {
  const { state } = view;
  const { $from } = state.selection;

  const containerStart = $from.before(containerDepth);
  const childStart = $from.before(childDepth);
  const childEnd = $from.after(childDepth);

  let tr = state.tr;

  // 删除空的子节点
  tr = tr.delete(childStart, childEnd);

  // 检查容器是否变空
  const updatedContainer = tr.doc.nodeAt(containerStart);
  if (updatedContainer && updatedContainer.content.size === 0) {
    // 容器空了 → 删除容器，创建 textBlock
    tr = tr.delete(containerStart, containerStart + updatedContainer.nodeSize);
    const newBlock = state.schema.nodes.textBlock.create();
    tr = tr.insert(containerStart, newBlock);
    tr = tr.setSelection(TextSelection.create(tr.doc, containerStart + 1));
  } else {
    // 容器还有内容 → 在容器后创建 textBlock
    const newContainerEnd = containerStart + (tr.doc.nodeAt(containerStart)?.nodeSize ?? 0);
    const newBlock = state.schema.nodes.textBlock.create();
    tr = tr.insert(newContainerEnd, newBlock);
    tr = tr.setSelection(TextSelection.create(tr.doc, newContainerEnd + 1));
  }

  view.dispatch(tr);
}

/**
 * 在 Container 内分裂：光标位置创建新 textBlock
 */
function splitInContainer(
  view: import('prosemirror-view').EditorView,
  childDepth: number,
): void {
  const { state } = view;
  const { $from } = state.selection;
  const cursorOffset = $from.parentOffset;
  const childNode = $from.parent;

  let tr = state.tr;

  if (cursorOffset === childNode.content.size) {
    // 光标在末尾 → 在当前行之后插入新空 textBlock
    const insertPos = $from.after(childDepth);
    const newBlock = state.schema.nodes.textBlock.create();
    tr = tr.insert(insertPos, newBlock);
    tr = tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
  } else if (cursorOffset === 0) {
    // 光标在开头 → 在当前行之前插入新空 textBlock
    const insertPos = $from.before(childDepth);
    const newBlock = state.schema.nodes.textBlock.create();
    tr = tr.insert(insertPos, newBlock);
    // 光标保持在原位置（原内容下移一行）
    tr = tr.setSelection(TextSelection.create(tr.doc, insertPos + newBlock.nodeSize + 1));
  } else {
    // 光标在中间 → 分裂 textBlock（在 textBlock 层级 split）
    tr = tr.split($from.pos, 1);
  }

  view.dispatch(tr);
}

/**
 * Unwrap：将当前 textBlock 从 Container 中提取出来
 */
function unwrapFromContainer(
  view: import('prosemirror-view').EditorView,
  containerDepth: number,
  childDepth: number,
): void {
  const { state } = view;
  const { $from } = state.selection;

  const containerStart = $from.before(containerDepth);
  const childStart = $from.before(childDepth);
  const childEnd = $from.after(childDepth);
  const childNode = $from.parent;

  let tr = state.tr;

  // 复制当前 textBlock
  const copy = childNode.copy(childNode.content);

  // 从 Container 中删除
  tr = tr.delete(childStart, childEnd);

  // 检查容器是否变空
  const updatedContainer = tr.doc.nodeAt(containerStart);
  if (updatedContainer && updatedContainer.content.size === 0) {
    // 容器空了 → 替换容器为 textBlock
    tr = tr.replaceWith(containerStart, containerStart + updatedContainer.nodeSize, copy);
  } else {
    // 容器还有内容 → 在容器前插入 textBlock
    tr = tr.insert(containerStart, copy);
  }

  // 光标放到提取出的 textBlock 内
  tr = tr.setSelection(TextSelection.create(tr.doc, containerStart + 1));

  view.dispatch(tr);
}
