import { Plugin } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';

/**
 * CodeBlock Keyboard Plugin — 代码块专用键盘处理
 *
 * Enter → 插入换行（newline）
 * Enter（空行） → 删除空行，在 codeBlock 后创建 textBlock（double-enter 退出）
 * Tab → 插入 2 个空格（代码缩进）
 * Shift+Tab → 删除行首 2 个空格（反缩进）
 * Backspace（block 为空） → 删除 codeBlock，创建 textBlock
 */

const INDENT = '  '; // 2 spaces

export function codeBlockKeyboardPlugin(): Plugin {
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        const { state } = view;
        const { $from } = state.selection;

        // 只处理光标在 codeBlock 内的情况
        // codeBlock 是 content: 'text*'，光标直接在 codeBlock 内部（depth=1: doc > codeBlock）
        const blockNode = $from.node($from.depth);
        if (!blockNode || blockNode.type.name !== 'codeBlock') return false;

        // ── Enter ──
        if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
          event.preventDefault();

          const textContent = blockNode.textContent;
          const cursorOffset = $from.parentOffset;

          // 检查 double-enter 退出条件：光标在末尾，且最后一个字符是换行
          if (cursorOffset === textContent.length && textContent.endsWith('\n')) {
            // 删除末尾换行，在 codeBlock 后创建 textBlock
            const blockPos = $from.before($from.depth);
            const blockEnd = $from.after($from.depth);

            let tr = state.tr;

            // 删除末尾换行符
            tr = tr.delete($from.pos - 1, $from.pos);

            // 在 codeBlock 后插入 textBlock
            const mappedEnd = tr.mapping.map(blockEnd);
            const newBlock = state.schema.nodes.textBlock.create();
            tr = tr.insert(mappedEnd, newBlock);
            tr = tr.setSelection(TextSelection.create(tr.doc, mappedEnd + 1));

            // 如果 codeBlock 变空了，替换为 textBlock
            const mappedBlockPos = tr.mapping.map(blockPos);
            const updatedBlock = tr.doc.nodeAt(mappedBlockPos);
            if (updatedBlock && updatedBlock.textContent === '') {
              tr = tr.delete(mappedBlockPos, mappedBlockPos + updatedBlock.nodeSize);
            }

            view.dispatch(tr);
            return true;
          }

          // 普通 Enter → 插入换行
          view.dispatch(state.tr.replaceSelectionWith(state.schema.text('\n')));
          return true;
        }

        // ── Tab ──
        if (event.key === 'Tab' && !event.shiftKey) {
          event.preventDefault();
          view.dispatch(state.tr.replaceSelectionWith(state.schema.text(INDENT)));
          return true;
        }

        // ── Shift+Tab（反缩进：删除行首空格） ──
        if (event.key === 'Tab' && event.shiftKey) {
          event.preventDefault();

          const textContent = blockNode.textContent;
          const cursorOffset = $from.parentOffset;

          // 找到当前行的行首位置
          const textBefore = textContent.slice(0, cursorOffset);
          const lineStart = textBefore.lastIndexOf('\n') + 1; // 0 if no newline

          // 检查行首是否有空格可以删除
          const lineText = textContent.slice(lineStart);
          let spacesToRemove = 0;
          if (lineText.startsWith(INDENT)) {
            spacesToRemove = INDENT.length;
          } else if (lineText.startsWith(' ')) {
            spacesToRemove = 1;
          }

          if (spacesToRemove > 0) {
            const blockStart = $from.start($from.depth);
            const deleteFrom = blockStart + lineStart;
            const deleteTo = deleteFrom + spacesToRemove;
            view.dispatch(state.tr.delete(deleteFrom, deleteTo));
          }
          return true;
        }

        // ── Backspace（codeBlock 为空 → 替换为 textBlock） ──
        if (event.key === 'Backspace') {
          if (blockNode.content.size === 0) {
            event.preventDefault();
            const blockPos = $from.before($from.depth);
            const blockEnd = $from.after($from.depth);
            const newBlock = state.schema.nodes.textBlock.create();
            const tr = state.tr.replaceWith(blockPos, blockEnd, newBlock);
            tr.setSelection(TextSelection.create(tr.doc, blockPos + 1));
            view.dispatch(tr);
            return true;
          }
          return false;
        }

        return false;
      },
    },
  });
}
