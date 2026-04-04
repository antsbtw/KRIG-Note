import { Plugin, PluginKey } from 'prosemirror-state';

/**
 * Slash Command Plugin — 监听 / 输入，触发 SlashMenu
 *
 * 在行首或空行输入 / 时打开菜单。
 * 后续输入过滤候选项。
 * Enter 确认 / Escape 关闭。
 */

export interface SlashCommandState {
  active: boolean;
  query: string;
  from: number;  // / 字符的位置
  to: number;    // 当前输入末尾位置
}

const INITIAL: SlashCommandState = { active: false, query: '', from: 0, to: 0 };

export const slashCommandKey = new PluginKey<SlashCommandState>('slashCommand');

export function slashCommandPlugin(): Plugin {
  return new Plugin({
    key: slashCommandKey,

    state: {
      init(): SlashCommandState { return INITIAL; },
      apply(tr, prev): SlashCommandState {
        const meta = tr.getMeta(slashCommandKey);
        if (meta?.close) return INITIAL;
        if (meta?.open) return { active: true, query: '', from: meta.from, to: meta.to };

        if (!prev.active) return prev;

        // 文档变化时更新 query
        if (tr.docChanged) {
          const $from = tr.doc.resolve(tr.selection.from);
          const textBefore = $from.parent.textBetween(0, $from.parentOffset);
          const slashIdx = textBefore.lastIndexOf('/');
          if (slashIdx < 0) return INITIAL; // / 被删除了
          const query = textBefore.slice(slashIdx + 1);
          const blockStart = $from.start();
          return { active: true, query, from: blockStart + slashIdx, to: tr.selection.from };
        }

        return prev;
      },
    },

    props: {
      handleKeyDown(view, event) {
        const state = slashCommandKey.getState(view.state);

        // 打开菜单
        if (event.key === '/' && !state?.active) {
          // 检查是否在 textBlock 中
          const { $from } = view.state.selection;
          if ($from.parent.type.name !== 'textBlock') return false;

          // 延迟检查（让 / 先输入到文档中）
          setTimeout(() => {
            const currentState = slashCommandKey.getState(view.state);
            if (currentState?.active) return;

            const { $from: $f } = view.state.selection;
            const textBefore = $f.parent.textBetween(0, $f.parentOffset);
            if (textBefore.endsWith('/')) {
              const blockStart = $f.start();
              const slashPos = blockStart + textBefore.length - 1;
              view.dispatch(view.state.tr.setMeta(slashCommandKey, {
                open: true, from: slashPos, to: view.state.selection.from,
              }));
            }
          }, 0);
          return false;
        }

        if (!state?.active) return false;

        // 关闭菜单
        if (event.key === 'Escape') {
          view.dispatch(view.state.tr.setMeta(slashCommandKey, { close: true }));
          return true;
        }

        return false;
      },
    },
  });
}
