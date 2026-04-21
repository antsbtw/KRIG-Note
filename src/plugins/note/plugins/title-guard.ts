/**
 * titleGuardPlugin — noteTitle 保护
 *
 * 1. appendTransaction: doc 第一个子节点不是 noteTitle 时自动补回
 * 2. handlePaste: 在 noteTitle 内粘贴时，强制纯文本插入（不拆分 block）
 * 3. appendTransaction: 光标在 pos 0（noteTitle 之前）时，移到 noteTitle 内部
 */

import { Plugin } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';

export function titleGuardPlugin(): Plugin {
  return new Plugin({
    props: {
      handlePaste(view, event, _slice) {
        const { state } = view;
        const { $from } = state.selection;

        // 只拦截 noteTitle 内的粘贴
        if ($from.depth < 1) return false;
        const blockNode = state.doc.nodeAt($from.before(1));
        if (!blockNode || blockNode.type.name !== 'textBlock' || !blockNode.attrs.isTitle) {
          return false;
        }

        // 取纯文本，作为 inline text 插入
        const text = event.clipboardData?.getData('text/plain');
        if (!text) return false;

        // 只取第一行（noteTitle 不应该有换行）
        const firstLine = text.split(/\r?\n/)[0] || '';
        if (!firstLine) return false;

        const tr = state.tr.insertText(firstLine);
        view.dispatch(tr);
        return true;
      },
    },

    appendTransaction(_transactions, _oldState, newState) {
      const firstChild = newState.doc.firstChild;

      // 第一个子节点不是 noteTitle → 补回
      if (
        !firstChild ||
        firstChild.type.name !== 'textBlock' ||
        !firstChild.attrs.isTitle
      ) {
        const titleNode = newState.schema.nodes.textBlock.create({ isTitle: true });
        const tr = newState.tr.insert(0, titleNode);
        tr.setMeta('addToHistory', false);
        return tr;
      }

      // 光标在 noteTitle 之前（pos 0）→ 移入 noteTitle 内部
      const sel = newState.selection;
      if (sel.from === 0 && sel.to === 0) {
        try {
          const tr = newState.tr.setSelection(TextSelection.create(newState.doc, 1));
          tr.setMeta('addToHistory', false);
          return tr;
        } catch { /* ignore */ }
      }

      return null;
    },
  });
}
