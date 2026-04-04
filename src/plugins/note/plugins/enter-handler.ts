import { Plugin } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import { blockRegistry } from '../registry';

/**
 * Enter Handler Plugin（框架级）
 *
 * 统一处理所有 Block 的 Enter 行为。
 * 从 BlockRegistry 读取每个 Block 的 enterBehavior 声明，
 * 根据声明执行对应的动作和退出逻辑。
 *
 * 默认行为（无 enterBehavior 声明）：splitBlock（ProseMirror 默认）
 */

export function enterHandlerPlugin(): Plugin {
  // 追踪连续空行 Enter 次数（用于 double-enter 退出）
  let consecutiveEmptyEnters = 0;

  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (event.key !== 'Enter' || event.shiftKey) return false;

        const { state } = view;
        const { $from } = state.selection;

        // 找到光标所在的最近 Block 节点
        let blockNode = $from.parent;
        let blockDepth = $from.depth;

        // 向上查找到有 enterBehavior 声明的 Block
        let behavior = blockRegistry.get(blockNode.type.name)?.enterBehavior;

        // 如果当前节点没有声明，检查父节点（如 listItem 内的 paragraph）
        if (!behavior && blockDepth > 1) {
          const parentNode = $from.node(blockDepth - 1);
          const parentBehavior = blockRegistry.get(parentNode.type.name)?.enterBehavior;
          if (parentBehavior) {
            behavior = parentBehavior;
            blockNode = parentNode;
            blockDepth = blockDepth - 1;
          }
        }

        // 无声明 → 使用 ProseMirror 默认行为（splitBlock）
        if (!behavior) {
          consecutiveEmptyEnters = 0;
          return false;
        }

        const isEmpty = blockNode.textContent.length === 0;

        // 对 codeBlock (newline + double-enter)：检查光标是否在末尾空行
        const isAtEmptyLine = (() => {
          if (behavior.action !== 'newline') return isEmpty;
          const text = blockNode.textContent;
          const cursorOffset = $from.parentOffset;
          // 光标在末尾，且末尾是换行符（上一次 Enter 产生的）
          return cursorOffset === text.length && text.endsWith('\n');
        })();

        // ── 退出条件检查 ──

        if (behavior.exitCondition === 'always') {
          // 每次 Enter 都退出（如 noteTitle）
          event.preventDefault();
          exitToNextParagraph(view, blockNode, blockDepth);
          consecutiveEmptyEnters = 0;
          return true;
        }

        if (behavior.exitCondition === 'empty-enter' && isEmpty) {
          // 空内容时 Enter 退出（如 listItem、blockquote）
          event.preventDefault();
          exitFromContainer(view, blockDepth);
          consecutiveEmptyEnters = 0;
          return true;
        }

        if (behavior.exitCondition === 'double-enter') {
          if (isAtEmptyLine) {
            // 光标在末尾空行 → 退出 codeBlock
            event.preventDefault();
            exitFromBlock(view, blockNode, blockDepth);
            consecutiveEmptyEnters = 0;
            return true;
          }
        }

        // ── 执行 Enter 动作 ──

        if (behavior.action === 'newline') {
          // 在 Block 内部换行（如 codeBlock）
          // 不拦截，让 ProseMirror 默认的 newlineInCode 处理
          return false;
        }

        if (behavior.action === 'exit') {
          // 直接退出（已在上面的 always 条件中处理）
          return false;
        }

        // action === 'split' → 在 Container 内分裂 textBlock
        // 不能用 ProseMirror 默认 splitBlock（defining Container 会导致分裂 Container 而非子 textBlock）
        if (behavior.action === 'split' && blockDepth < $from.depth) {
          // blockNode 是 Container（如 bulletList），光标在其子 textBlock 中
          event.preventDefault();
          const childNode = $from.parent; // textBlock
          const childDepth = $from.depth;
          const childPos = $from.before(childDepth);
          const cursorInChild = $from.parentOffset;

          const tr = state.tr;
          const newBlock = state.schema.nodes.textBlock.create();

          if (cursorInChild === childNode.content.size) {
            // 光标在末尾 → 在当前 textBlock 之后插入新 textBlock
            const insertPos = $from.after(childDepth);
            tr.insert(insertPos, newBlock);
            tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
          } else if (cursorInChild === 0) {
            // 光标在开头 → 在当前 textBlock 之前插入新 textBlock
            tr.insert(childPos, newBlock);
            tr.setSelection(TextSelection.create(tr.doc, childPos + childNode.nodeSize + 1 + 1));
          } else {
            // 光标在中间 → 分裂 textBlock
            // 使用 ProseMirror 的 split 命令在 textBlock 层级分裂
            tr.split($from.pos, 1);
          }

          view.dispatch(tr);
          consecutiveEmptyEnters = 0;
          return true;
        }

        // 其他 split → 使用 ProseMirror 默认的 splitBlock
        consecutiveEmptyEnters = 0;
        return false;
      },
    },
  });
}

/** 退出到 Block 下方的 paragraph */
function exitToNextParagraph(
  view: import('prosemirror-view').EditorView,
  blockNode: import('prosemirror-model').Node,
  blockDepth: number,
): void {
  const { state } = view;
  const $from = state.selection.$from;

  // 找到当前 Block 在文档中的结束位置
  const blockStart = $from.before(blockDepth);
  const blockEnd = blockStart + blockNode.nodeSize;

  const tr = state.tr;

  // 如果 Block 后面没有内容，创建一个 paragraph
  if (blockEnd >= state.doc.content.size) {
    const paragraphType = state.schema.nodes.textBlock || state.schema.nodes.paragraph;
    tr.insert(blockEnd, paragraphType.create());
    tr.setSelection(TextSelection.create(tr.doc, blockEnd + 1));
  } else {
    // 跳到下一个可编辑位置
    const $pos = tr.doc.resolve(blockEnd);
    const sel = TextSelection.near($pos);
    tr.setSelection(sel);
  }

  view.dispatch(tr);
}

/** 从 Container 中退出（将空子节点移出容器） */
function exitFromContainer(
  view: import('prosemirror-view').EditorView,
  blockDepth: number,
): void {
  const { state } = view;
  const { $from } = state.selection;

  // 尝试使用 liftListItem 或类似的提升操作
  // 简化实现：将光标移到容器后面，创建新 paragraph
  const containerStart = $from.before(blockDepth);
  const containerNode = $from.node(blockDepth);
  const containerEnd = containerStart + containerNode.nodeSize;

  const tr = state.tr;

  // 删除空的子节点
  const childStart = $from.before($from.depth);
  const childEnd = childStart + $from.parent.nodeSize;
  tr.delete(childStart, childEnd);

  // 如果容器变空了，删除容器并创建 paragraph
  const updatedContainer = tr.doc.nodeAt(containerStart);
  if (updatedContainer && updatedContainer.content.size === 0) {
    tr.delete(containerStart, containerStart + updatedContainer.nodeSize);
    const paragraphType = state.schema.nodes.paragraph;
    tr.insert(containerStart, paragraphType.create());
    tr.setSelection(TextSelection.create(tr.doc, containerStart + 1));
  } else {
    // 容器还有其他子节点，在容器后创建 paragraph
    const newEnd = containerStart + (tr.doc.nodeAt(containerStart)?.nodeSize ?? 0);
    const paragraphType = state.schema.nodes.paragraph;
    tr.insert(newEnd, paragraphType.create());
    tr.setSelection(TextSelection.create(tr.doc, newEnd + 1));
  }

  view.dispatch(tr);
}

/** 从 Block 中退出（如 codeBlock double-enter） */
function exitFromBlock(
  view: import('prosemirror-view').EditorView,
  blockNode: import('prosemirror-model').Node,
  blockDepth: number,
): void {
  const { state } = view;
  const $from = state.selection.$from;

  const blockStart = $from.before(blockDepth);
  const blockEnd = blockStart + blockNode.nodeSize;

  const tr = state.tr;

  // 删除最后的空行（double-enter 产生的）
  const lastChild = blockNode.lastChild;
  if (lastChild && lastChild.textContent === '') {
    // 删除 Block 末尾的空内容
    const textEnd = blockEnd - 1;
    const textStart = textEnd - 1;
    if (textStart >= blockStart) {
      tr.delete(textStart, textEnd);
    }
  }

  // 在 Block 后创建 paragraph
  const newBlockEnd = blockStart + (tr.doc.nodeAt(blockStart)?.nodeSize ?? blockNode.nodeSize);
  const paragraphType = state.schema.nodes.paragraph;
  tr.insert(newBlockEnd, paragraphType.create());
  tr.setSelection(TextSelection.create(tr.doc, newBlockEnd + 1));

  view.dispatch(tr);
}
