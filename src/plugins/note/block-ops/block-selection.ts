import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { Node as PMNode } from 'prosemirror-model';
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

        // Cmd+V：粘贴 Block（无论是否选中，只要内部剪贴板有内容）
        if ((event.metaKey || event.ctrlKey) && event.key === 'v') {
          const clipboard = (globalThis as any).__blockClipboard as { json: unknown }[] | undefined;
          if (clipboard && clipboard.length > 0) {
            event.preventDefault();
            const { $from } = view.state.selection;
            const blockPos = $from.depth >= 1 ? $from.after(1) : $from.pos;

            let tr = view.state.tr;
            let currentPos = blockPos;
            for (const item of clipboard) {
              const node = PMNode.fromJSON(view.state.schema, item.json as Record<string, unknown>);
              tr = tr.insert(currentPos, node);
              currentPos += node.nodeSize;
            }
            if (isActive) tr.setMeta(blockSelectionKey, { clear: true });
            view.dispatch(tr);
            return true;
          }
          return false;
        }

        if (!isActive) return false;

        // Tab / Shift+Tab：批量缩进
        if (event.key === 'Tab') {
          event.preventDefault();
          const sorted = [...state!.positions].sort((a, b) => a - b);
          const delta = event.shiftKey ? -1 : 1;
          let tr = view.state.tr;
          for (const pos of sorted) {
            const node = tr.doc.nodeAt(pos);
            if (!node || !node.type.spec.attrs || !('indent' in node.type.spec.attrs)) continue;
            const current = (node.attrs.indent as number) || 0;
            const next = Math.max(0, Math.min(8, current + delta));
            if (next !== current) {
              tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
            }
          }
          view.dispatch(tr);
          return true;
        }

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

        // Cmd+C：复制选中的 Block
        if ((event.metaKey || event.ctrlKey) && event.key === 'c') {
          event.preventDefault();
          // 收集选中 Block 的 JSON 到内部剪贴板
          const sorted = [...state!.positions].sort((a, b) => a - b);
          const items: { json: unknown }[] = [];
          for (const pos of sorted) {
            const node = view.state.doc.nodeAt(pos);
            if (node) items.push({ json: node.toJSON() });
          }
          if (items.length > 0) {
            (globalThis as any).__blockClipboard = items;
          }
          return true;
        }

        // Cmd+X：剪切选中的 Block
        if ((event.metaKey || event.ctrlKey) && event.key === 'x') {
          event.preventDefault();
          // 先复制
          const sorted = [...state!.positions].sort((a, b) => a - b);
          const items: { json: unknown }[] = [];
          for (const pos of sorted) {
            const node = view.state.doc.nodeAt(pos);
            if (node) items.push({ json: node.toJSON() });
          }
          if (items.length > 0) {
            (globalThis as any).__blockClipboard = items;
          }
          // 再删除（从后往前）
          const reverseSorted = [...state!.positions].sort((a, b) => b - a);
          let tr = view.state.tr;
          for (const pos of reverseSorted) {
            const node = tr.doc.nodeAt(pos);
            if (node) tr = tr.delete(pos, pos + node.nodeSize);
          }
          tr.setMeta(blockSelectionKey, { clear: true });
          view.dispatch(tr);
          return true;
        }

        // ↑/↓（无 Shift）：切换选中的 Block
        if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.shiftKey) {
          event.preventDefault();
          const currentPos = state!.positions[state!.positions.length - 1];
          const adj = getAdjacentBlockPos(view, currentPos, event.key === 'ArrowUp' ? 'up' : 'down');
          if (adj !== null) {
            view.dispatch(view.state.tr.setMeta(blockSelectionKey, {
              action: 'select', positions: [adj],
            }));
          }
          return true;
        }

        // ←：取消选中，光标到第一个选中 Block 开头
        // →：取消选中，光标到最后一个选中 Block 末尾
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          const sorted = [...state!.positions].sort((a, b) => a - b);
          const tr = view.state.tr;
          tr.setMeta(blockSelectionKey, { clear: true });

          if (event.key === 'ArrowLeft') {
            const firstPos = sorted[0];
            tr.setSelection(TextSelection.near(tr.doc.resolve(firstPos + 1)));
          } else {
            const lastPos = sorted[sorted.length - 1];
            const lastNode = view.state.doc.nodeAt(lastPos);
            if (lastNode) {
              tr.setSelection(TextSelection.near(tr.doc.resolve(lastPos + lastNode.nodeSize - 1)));
            }
          }

          view.dispatch(tr);
          return true;
        }

        // 字符输入退出
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
          view.dispatch(view.state.tr.setMeta(blockSelectionKey, { clear: true }));
          return false;
        }

        return false;
      },

      handleDOMEvents: {
        mousedown(view, event) {
          if (event.button !== 0) return false;
          const pluginState = blockSelectionKey.getState(view.state);
          if (!pluginState?.active) return false;

          // 从 DOM 查找点击的顶层 block
          let target = event.target as HTMLElement | null;
          const pmDOM = view.dom;
          let blockDOM: HTMLElement | null = null;
          while (target && target !== pmDOM) {
            if (target.parentElement === pmDOM) { blockDOM = target; break; }
            target = target.parentElement;
          }

          if (event.shiftKey && blockDOM) {
            // Shift+点击 → 范围多选
            event.preventDefault();
            let clickBlockPos: number;
            try {
              const innerPos = view.posAtDOM(blockDOM, 0);
              const $pos = view.state.doc.resolve(innerPos);
              if ($pos.depth < 1) return true;
              clickBlockPos = $pos.before(1);
            } catch { return true; }

            const anchorPos = pluginState.positions[0];
            const minPos = Math.min(anchorPos, clickBlockPos);
            const maxPos = Math.max(anchorPos, clickBlockPos);

            const positions: number[] = [];
            view.state.doc.forEach((_node, offset) => {
              if (offset >= minPos && offset <= maxPos) positions.push(offset);
            });

            if (positions.length > 0) {
              view.dispatch(view.state.tr.setMeta(blockSelectionKey, {
                action: 'select', positions,
              }));
            }
            return true;
          }

          // 普通点击 → 取消选中
          view.dispatch(view.state.tr.setMeta(blockSelectionKey, { clear: true }));
          return false;
        },
      },

      // 右键不取消选中（保留 Block 选中状态给 ContextMenu）
      handleClick(view, _pos, event) {
        if (event.button !== 0) return false;
        const state = blockSelectionKey.getState(view.state);
        if (state?.active) {
          view.dispatch(view.state.tr.setMeta(blockSelectionKey, { clear: true }));
        }
        return false;
      },
    },
  });
}
