import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorView } from 'prosemirror-view';

/**
 * Block Selection Plugin — Block 选中状态管理
 *
 * 使用 ProseMirror Decorations 高亮（不直接操作 DOM，避免死循环）。
 *
 * ESC：选中光标所在 Block / 取消选中（toggle）
 * Shift+↑/↓：多选
 * 单击：取消选中
 */

export interface BlockSelectionState {
  active: boolean;
  positions: number[];
}

const INITIAL_STATE: BlockSelectionState = {
  active: false,
  positions: [],
};

export const blockSelectionKey = new PluginKey<BlockSelectionState>('blockSelection');

function getBlockPosAtCursor(view: EditorView): number | null {
  const { $from } = view.state.selection;
  if ($from.depth < 1) return null;
  return $from.before(1);
}

function getAdjacentBlockPos(view: EditorView, pos: number, direction: 'up' | 'down'): number | null {
  const doc = view.state.doc;
  const node = doc.nodeAt(pos);
  if (!node) return null;

  if (direction === 'down') {
    const nextPos = pos + node.nodeSize;
    if (nextPos < doc.content.size && doc.nodeAt(nextPos)) return nextPos;
  } else {
    let prevPos = -1;
    doc.forEach((_child, offset) => {
      if (offset < pos) prevPos = offset;
    });
    if (prevPos >= 0) return prevPos;
  }
  return null;
}

/** 从 positions 构建 DecorationSet */
function buildDecorations(state: BlockSelectionState, doc: import('prosemirror-model').Node): DecorationSet {
  if (!state.active || state.positions.length === 0) {
    return DecorationSet.empty;
  }

  const decorations: Decoration[] = [];
  for (const pos of state.positions) {
    const node = doc.nodeAt(pos);
    if (node) {
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class: 'block-selected',
        }),
      );
    }
  }

  return DecorationSet.create(doc, decorations);
}

export function blockSelectionPlugin(): Plugin {
  return new Plugin({
    key: blockSelectionKey,

    state: {
      init(): BlockSelectionState {
        return INITIAL_STATE;
      },

      apply(tr, prev): BlockSelectionState {
        const meta = tr.getMeta(blockSelectionKey);
        if (meta?.clear) return INITIAL_STATE;
        if (meta?.action === 'select') return { active: true, positions: meta.positions };
        if (meta?.action === 'extend') {
          return { active: true, positions: [...new Set([...prev.positions, ...meta.positions])] };
        }
        if (tr.docChanged && prev.active) return INITIAL_STATE;
        return prev;
      },
    },

    props: {
      // 使用 Decorations 高亮（安全，不触发 MutationObserver）
      decorations(state) {
        const pluginState = blockSelectionKey.getState(state);
        if (!pluginState) return DecorationSet.empty;
        return buildDecorations(pluginState, state.doc);
      },

      // 选中模式下添加 CSS class 到编辑器根元素
      attributes(state): Record<string, string> {
        const pluginState = blockSelectionKey.getState(state);
        if (pluginState?.active) {
          return { class: 'block-selection-active' };
        }
        return { class: '' };
      },

      handleKeyDown(view, event) {
        const state = blockSelectionKey.getState(view.state);
        const isActive = state?.active || false;

        // ESC toggle
        if (event.key === 'Escape') {
          event.preventDefault();
          if (isActive) {
            view.dispatch(view.state.tr.setMeta(blockSelectionKey, { clear: true }));
          } else {
            const blockPos = getBlockPosAtCursor(view);
            if (blockPos !== null) {
              view.dispatch(view.state.tr.setMeta(blockSelectionKey, {
                action: 'select', positions: [blockPos],
              }));
            }
          }
          return true;
        }

        if (!isActive) return false;

        // Shift+↑/↓ 多选
        if (event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          event.preventDefault();
          const lastPos = state!.positions[state!.positions.length - 1];
          const adj = getAdjacentBlockPos(view, lastPos, event.key === 'ArrowUp' ? 'up' : 'down');
          if (adj !== null) {
            view.dispatch(view.state.tr.setMeta(blockSelectionKey, {
              action: 'extend', positions: [adj],
            }));
          }
          return true;
        }

        // Delete/Backspace
        if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          const sorted = [...state!.positions].sort((a, b) => b - a);
          let tr = view.state.tr;
          for (const pos of sorted) {
            const node = tr.doc.nodeAt(pos);
            if (node) tr = tr.delete(pos, pos + node.nodeSize);
          }
          tr.setMeta(blockSelectionKey, { clear: true });
          view.dispatch(tr);
          return true;
        }

        // 方向键（无 Shift）退出
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) && !event.shiftKey) {
          view.dispatch(view.state.tr.setMeta(blockSelectionKey, { clear: true }));
          return false;
        }

        // 字符输入退出
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
          view.dispatch(view.state.tr.setMeta(blockSelectionKey, { clear: true }));
          return false;
        }

        return false;
      },

      // 左键单击取消选中（右键不取消，保留 Block 选中状态给 ContextMenu）
      handleClick(view, pos, event) {
        if (event.button !== 0) return false; // 只处理左键
        const state = blockSelectionKey.getState(view.state);
        if (state?.active) {
          view.dispatch(view.state.tr.setMeta(blockSelectionKey, { clear: true }));
        }
        return false;
      },
    },
  });
}
