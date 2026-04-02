import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

/**
 * NoteLink 输入插件
 *
 * 检测 [[ 输入，触发 NoteLink 搜索面板。
 * 面板由 React 组件 NoteLinkMenu 渲染。
 */

export const noteLinkInputKey = new PluginKey('noteLinkInput');

export interface NoteLinkInputState {
  active: boolean;
  from: number;    // [[ 的起始位置（第一个 [ 的位置）
  to: number;      // 当前输入结束位置
  query: string;   // [[ 之后的搜索文字
  coords: { left: number; bottom: number } | null;
}

const INITIAL: NoteLinkInputState = { active: false, from: 0, to: 0, query: '', coords: null };

export function noteLinkInputPlugin(): Plugin {
  let viewRef: EditorView | null = null;

  return new Plugin({
    key: noteLinkInputKey,

    view(v) {
      viewRef = v;
      return {
        update(view) { viewRef = view; },
        destroy() { viewRef = null; },
      };
    },

    state: {
      init(): NoteLinkInputState {
        return INITIAL;
      },
      apply(tr, prev): NoteLinkInputState {
        const meta = tr.getMeta(noteLinkInputKey);
        if (meta?.close) return INITIAL;
        if (meta?.open) return meta as NoteLinkInputState;

        if (!prev.active) {
          // 检测 [[ 输入：最近输入的两个字符是否是 [[
          if (tr.docChanged && tr.selection.$head.parentOffset >= 2) {
            const $head = tr.selection.$head;
            const pos = $head.pos;
            const textBefore = tr.doc.textBetween(pos - 2, pos, '');
            if (textBefore === '[[') {
              // 获取坐标
              let coords = { left: 0, bottom: 0 };
              if (viewRef) {
                try {
                  const c = viewRef.coordsAtPos(pos);
                  coords = { left: c.left, bottom: c.bottom };
                } catch { /* ignore */ }
              }
              return {
                active: true,
                from: pos - 2,
                to: pos,
                query: '',
                coords,
              };
            }
          }
          return prev;
        }

        // 已激活状态：更新 query
        const { from } = prev;
        const to = tr.selection.$head.pos;

        // 文档变化导致位置异常 → 关闭
        if (to < from) return INITIAL;

        const fullText = tr.doc.textBetween(from, to, '');
        // 去掉开头的 [[
        const query = fullText.startsWith('[[') ? fullText.slice(2) : fullText;

        // 输入了 ]] → 关闭
        if (query.includes(']]')) return INITIAL;

        // 输入了换行 → 关闭
        if (query.includes('\n')) return INITIAL;

        // 更新坐标
        let coords = prev.coords;
        if (viewRef) {
          try {
            const c = viewRef.coordsAtPos(to);
            coords = { left: c.left, bottom: c.bottom };
          } catch { /* keep old */ }
        }

        return { ...prev, to, query, coords };
      },
    },

    props: {
      handleKeyDown(view, event) {
        const state = noteLinkInputKey.getState(view.state) as NoteLinkInputState;
        if (!state?.active) return false;

        if (event.key === 'Escape') {
          view.dispatch(view.state.tr.setMeta(noteLinkInputKey, { close: true }));
          return true;
        }

        // Enter 和方向键由 NoteLinkMenu 组件处理
        if (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          // 不在这里处理，让事件冒泡到 NoteLinkMenu 的 keydown listener
          return false;
        }

        return false;
      },
    },
  });
}
