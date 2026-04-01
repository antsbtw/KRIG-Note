import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

/**
 * SlashCommand Plugin
 *
 * 检测用户输入 `/`，通知 React 组件显示 SlashMenu。
 * Plugin 只负责检测和定位，菜单渲染由 React 组件负责。
 */

export const slashCommandKey = new PluginKey('slashCommand');

export interface SlashCommandState {
  active: boolean;
  from: number;      // `/` 字符的文档位置
  to: number;        // 当前输入位置
  query: string;     // `/` 后面的搜索文字
  coords: { left: number; top: number; bottom: number } | null;
}

const INITIAL_STATE: SlashCommandState = {
  active: false,
  from: 0,
  to: 0,
  query: '',
  coords: null,
};

export function slashCommandPlugin(): Plugin {
  return new Plugin({
    key: slashCommandKey,

    state: {
      init(): SlashCommandState {
        return INITIAL_STATE;
      },

      apply(tr, prev): SlashCommandState {
        // 如果有 meta 指令（如关闭菜单），执行
        const meta = tr.getMeta(slashCommandKey);
        if (meta?.close) return INITIAL_STATE;

        // 只在文本输入时检测
        if (!tr.docChanged) return prev;

        const { $from } = tr.selection;
        const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');

        // 检测 `/` 开头的输入
        const slashMatch = textBefore.match(/\/(\w*)$/);
        if (slashMatch) {
          const from = $from.pos - slashMatch[0].length;
          const to = $from.pos;
          return {
            active: true,
            from,
            to,
            query: slashMatch[1],
            coords: null, // 由 view 更新
          };
        }

        return INITIAL_STATE;
      },
    },

    view() {
      return {
        update(view: EditorView) {
          const state = slashCommandKey.getState(view.state) as SlashCommandState;
          if (state?.active) {
            // 计算 `/` 的屏幕坐标
            try {
              const coords = view.coordsAtPos(state.from);
              (state as SlashCommandState).coords = coords;
            } catch {
              // 位置无效时忽略
            }
          }
        },
      };
    },
  });
}
