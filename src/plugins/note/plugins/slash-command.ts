import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

/**
 * SlashCommand Plugin
 *
 * 检测用户输入 `/`，管理 SlashMenu 的状态和键盘导航。
 * 当 SlashMenu 激活时，拦截 Enter/Escape/方向键（优先于其他 plugin）。
 */

export const slashCommandKey = new PluginKey('slashCommand');

export interface SlashCommandState {
  active: boolean;
  from: number;
  to: number;
  query: string;
  coords: { left: number; top: number; bottom: number } | null;
  selectedIndex: number;
  itemCount: number;
}

const INITIAL_STATE: SlashCommandState = {
  active: false,
  from: 0,
  to: 0,
  query: '',
  coords: null,
  selectedIndex: 0,
  itemCount: 0,
};

export function slashCommandPlugin(): Plugin {
  return new Plugin({
    key: slashCommandKey,

    state: {
      init(): SlashCommandState {
        return INITIAL_STATE;
      },

      apply(tr, prev): SlashCommandState {
        const meta = tr.getMeta(slashCommandKey);
        if (meta?.close) return INITIAL_STATE;
        if (meta?.setSelectedIndex !== undefined) {
          return { ...prev, selectedIndex: meta.setSelectedIndex };
        }
        if (meta?.setItemCount !== undefined) {
          return { ...prev, itemCount: meta.setItemCount };
        }

        if (!tr.docChanged) return prev;

        const { $from } = tr.selection;
        const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');

        const slashMatch = textBefore.match(/\/(\w*)$/);
        if (slashMatch) {
          const from = $from.pos - slashMatch[0].length;
          const to = $from.pos;
          return {
            active: true,
            from,
            to,
            query: slashMatch[1],
            coords: null,
            selectedIndex: prev.active ? prev.selectedIndex : 0,
            itemCount: prev.itemCount,
          };
        }

        return INITIAL_STATE;
      },
    },

    props: {
      handleKeyDown(view, event) {
        const state = slashCommandKey.getState(view.state) as SlashCommandState;
        if (!state?.active) return false;

        // 没有匹配项时不拦截（让正常输入通过）
        if (state.itemCount === 0) return false;

        // SlashMenu 有匹配项时拦截这些键
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          const newIndex = Math.min(state.selectedIndex + 1, state.itemCount - 1);
          view.dispatch(view.state.tr.setMeta(slashCommandKey, { setSelectedIndex: newIndex }));
          return true;
        }

        if (event.key === 'ArrowUp') {
          event.preventDefault();
          const newIndex = Math.max(state.selectedIndex - 1, 0);
          view.dispatch(view.state.tr.setMeta(slashCommandKey, { setSelectedIndex: newIndex }));
          return true;
        }

        if (event.key === 'Enter') {
          event.preventDefault();
          view.dom.dispatchEvent(new CustomEvent('slash-execute', {
            detail: { selectedIndex: state.selectedIndex },
          }));
          return true;
        }

        // ESC 不拦截 → 交给 blockSelection 处理
        // SlashMenu 通过点击菜单外或删除 / 字符关闭

        return false;
      },
    },

    view() {
      return {
        update(view: EditorView) {
          const state = slashCommandKey.getState(view.state) as SlashCommandState;
          if (state?.active) {
            try {
              const coords = view.coordsAtPos(state.from);
              (state as SlashCommandState).coords = coords;
            } catch { /* ignore */ }
          }
        },
      };
    },
  });
}
