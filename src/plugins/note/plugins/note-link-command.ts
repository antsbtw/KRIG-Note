import { Plugin, PluginKey } from 'prosemirror-state';

/**
 * Note Link Command Plugin — 监听 [[ 输入，触发笔记搜索面板
 *
 * 输入 [[ 时打开搜索面板。
 * 后续输入过滤笔记列表。
 * Enter 确认插入 noteLink / Escape 关闭。
 */

export interface NoteLinkCommandState {
  active: boolean;
  query: string;
  from: number;  // [[ 起始位置
  to: number;    // 当前输入末尾位置
}

const INITIAL: NoteLinkCommandState = { active: false, query: '', from: 0, to: 0 };

export const noteLinkCommandKey = new PluginKey<NoteLinkCommandState>('noteLinkCommand');

export function noteLinkCommandPlugin(): Plugin {
  return new Plugin({
    key: noteLinkCommandKey,

    state: {
      init(): NoteLinkCommandState { return INITIAL; },
      apply(tr, prev): NoteLinkCommandState {
        const meta = tr.getMeta(noteLinkCommandKey);
        if (meta?.close) return INITIAL;
        if (meta?.open) return { active: true, query: '', from: meta.from, to: meta.to };

        if (!prev.active) return prev;

        // 文档变化时更新 query
        if (tr.docChanged) {
          const $from = tr.doc.resolve(tr.selection.from);
          const textBefore = $from.parent.textBetween(0, $from.parentOffset);
          const bracketIdx = textBefore.lastIndexOf('[[');
          if (bracketIdx < 0) return INITIAL; // [[ 被删除了
          // 如果输入了 ]]，也关闭
          const query = textBefore.slice(bracketIdx + 2);
          if (query.includes(']]')) return INITIAL;
          const blockStart = $from.start();
          return { active: true, query, from: blockStart + bracketIdx, to: tr.selection.from };
        }

        return prev;
      },
    },

    props: {
      handleTextInput(view, from, to, text) {
        // 检测输入 [ 后前一个字符也是 [
        if (text !== '[') return false;
        const state = noteLinkCommandKey.getState(view.state);
        if (state?.active) return false;

        const { $from } = view.state.selection;
        if ($from.parent.type.name !== 'textBlock') return false;

        // 延迟检查（让 [ 先输入到文档中）
        setTimeout(() => {
          const currentState = noteLinkCommandKey.getState(view.state);
          if (currentState?.active) return;

          const { $from: $f } = view.state.selection;
          const textBefore = $f.parent.textBetween(0, $f.parentOffset);
          if (textBefore.endsWith('[[')) {
            const blockStart = $f.start();
            const bracketPos = blockStart + textBefore.length - 2;
            view.dispatch(view.state.tr.setMeta(noteLinkCommandKey, {
              open: true, from: bracketPos, to: view.state.selection.from,
            }));
          }
        }, 0);
        return false;
      },

      handleKeyDown(view, event) {
        const state = noteLinkCommandKey.getState(view.state);
        if (!state?.active) return false;

        if (event.key === 'Escape') {
          view.dispatch(view.state.tr.setMeta(noteLinkCommandKey, { close: true }));
          return true;
        }

        // Enter / ArrowUp / ArrowDown 由 NoteLinkSearch 组件处理
        if (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          return true;
        }

        return false;
      },
    },
  });
}
