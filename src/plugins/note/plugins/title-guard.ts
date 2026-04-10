/**
 * titleGuardPlugin — noteTitle 保护
 *
 * 1. appendTransaction: doc 第一个子节点不是 noteTitle 时自动补回
 * 2. handlePaste: 在 noteTitle 内粘贴时，强制纯文本插入（不拆分 block）
 */

import { Plugin } from 'prosemirror-state';

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

      // 第一个子节点已经是 noteTitle，无需修复
      if (
        firstChild &&
        firstChild.type.name === 'textBlock' &&
        firstChild.attrs.isTitle
      ) {
        return null;
      }

      // 需要修复：在 doc 开头插入一个空的 noteTitle
      const titleNode = newState.schema.nodes.textBlock.create({ isTitle: true });
      const tr = newState.tr.insert(0, titleNode);
      tr.setMeta('addToHistory', false);
      return tr;
    },
  });
}
