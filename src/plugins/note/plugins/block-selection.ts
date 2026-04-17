import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { Node as PMNode } from 'prosemirror-model';
import { findTopBlockPos } from './block-handle';

/**
 * Block Selection Plugin — ESC 选中 Block，↑/↓ 导航，Shift 多选
 *
 * 必须在所有 keymap 之前注册（最高优先级）。
 */

export interface BlockSelectionState {
  active: boolean;
  selectedPositions: number[];
  anchorPos: number | null;
}

const INITIAL: BlockSelectionState = { active: false, selectedPositions: [], anchorPos: null };

export const blockSelectionKey = new PluginKey<BlockSelectionState>('blockSelection');

// ── 辅助函数 ──

/**
 * 获取所有可选中 block 的位置（视觉顺序）
 *
 * 普通 block → 直接加入
 * columnList → 展开为: 左列子block从上到下 → 右列子block从上到下 → (第三列...)
 * columnList/column 自身不加入（它们只是布局容器）
 */
function getAllBlockPositions(doc: PMNode): number[] {
  const positions: number[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name === 'columnList') {
      // 展开 columnList：遍历每个 column 的子 block
      let colOffset = offset + 1; // 进入 columnList
      for (let c = 0; c < node.childCount; c++) {
        const column = node.child(c);
        if (column.type.name === 'column') {
          let blockOffset = colOffset + 1; // 进入 column
          for (let b = 0; b < column.childCount; b++) {
            positions.push(blockOffset);
            blockOffset += column.child(b).nodeSize;
          }
        }
        colOffset += column.nodeSize;
      }
    } else {
      positions.push(offset);
    }
  });
  return positions;
}

/**
 * 找到光标所在的可选中 block 位置
 * 如果在 column 内，定位到 column 的直接子 block
 * 否则定位到顶层 block
 */
function findSelectableBlockPos(doc: PMNode, $from: import('prosemirror-model').ResolvedPos): number | null {
  // 检查是否在 column 内部
  for (let d = $from.depth; d >= 1; d--) {
    if ($from.node(d).type.name === 'column') {
      // 找 column 的直接子 block（depth = d + 1）
      if ($from.depth > d) {
        return $from.before(d + 1);
      }
      break;
    }
  }
  // 普通 block：顶层
  return findTopBlockPos(doc, $from.pos);
}

/** 找相邻 block */
function getAdjacentBlockPos(doc: PMNode, currentPos: number, direction: 'up' | 'down'): number | null {
  const positions = getAllBlockPositions(doc);
  const idx = positions.indexOf(currentPos);
  if (idx < 0) return null;
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= positions.length) return null;
  return positions[targetIdx];
}

/** 获取两个位置之间的所有 block 位置（含端点） */
function getBlockRange(doc: PMNode, fromPos: number, toPos: number): number[] {
  const positions = getAllBlockPositions(doc);
  const fromIdx = positions.indexOf(fromPos);
  const toIdx = positions.indexOf(toPos);
  if (fromIdx < 0 || toIdx < 0) return [];
  const minIdx = Math.min(fromIdx, toIdx);
  const maxIdx = Math.max(fromIdx, toIdx);
  return positions.slice(minIdx, maxIdx + 1);
}

// ── Plugin ──

export function blockSelectionPlugin(): Plugin {
  return new Plugin({
    key: blockSelectionKey,

    state: {
      init(): BlockSelectionState {
        return INITIAL;
      },
      apply(tr, prev): BlockSelectionState {
        const meta = tr.getMeta(blockSelectionKey);
        if (meta) return meta;

        if (!prev.active) return prev;

        // 文档变化时重映射位置
        if (tr.docChanged) {
          const mapped = prev.selectedPositions
            .map(p => tr.mapping.map(p))
            .filter(p => p >= 0 && p < tr.doc.content.size);
          const anchor = prev.anchorPos !== null ? tr.mapping.map(prev.anchorPos) : null;
          if (mapped.length === 0) return INITIAL;
          return { active: true, selectedPositions: mapped, anchorPos: anchor };
        }

        return prev;
      },
    },

    props: {
      decorations(state) {
        const pluginState = blockSelectionKey.getState(state);
        if (!pluginState?.active || pluginState.selectedPositions.length === 0) {
          return DecorationSet.empty;
        }

        const decos: Decoration[] = [];
        for (const pos of pluginState.selectedPositions) {
          const node = state.doc.nodeAt(pos);
          if (node) {
            decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'block-selected' }));
          }
        }
        return DecorationSet.create(state.doc, decos);
      },

      handleKeyDown(view, event) {
        const state = blockSelectionKey.getState(view.state);
        const active = state?.active ?? false;

        // ── ESC：进入/退出选中 ──
        if (event.key === 'Escape') {
          if (active) {
            exitSelection(view);
            return true;
          }
          // 进入选中
          const { $from } = view.state.selection;
          if ($from.depth < 1) return false;
          const pos = findSelectableBlockPos(view.state.doc, $from);
          if (pos === null) return false;
          // noteTitle 不选中
          const node = view.state.doc.nodeAt(pos);
          if (node?.type.name === 'textBlock' && node.attrs.isTitle) return false;

          enterSelection(view, pos);
          return true;
        }

        if (!active) return false;

        // ── 以下都需要在 active 模式下 ──

        // ← → 退出选中，定位光标
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          const positions = state!.selectedPositions;
          const sorted = [...positions].sort((a, b) => a - b);
          exitSelection(view);
          try {
            if (event.key === 'ArrowLeft') {
              // ← 光标到第一个 block 开头
              const firstPos = sorted[0];
              const tr = view.state.tr.setSelection(
                TextSelection.near(view.state.doc.resolve(firstPos + 1))
              );
              view.dispatch(tr);
            } else {
              // → 光标到最后一个 block 末尾
              const lastPos = sorted[sorted.length - 1];
              const lastNode = view.state.doc.nodeAt(lastPos);
              if (lastNode) {
                const endPos = lastPos + lastNode.nodeSize - 1;
                const tr = view.state.tr.setSelection(
                  TextSelection.near(view.state.doc.resolve(endPos), -1)
                );
                view.dispatch(tr);
              }
            }
          } catch {}
          return true;
        }

        // Enter → 退出选中，光标进入第一个 block
        if (event.key === 'Enter') {
          const firstPos = state!.selectedPositions[0];
          exitSelection(view);
          try {
            const tr = view.state.tr.setSelection(
              TextSelection.near(view.state.doc.resolve(firstPos + 1))
            );
            view.dispatch(tr);
          } catch {}
          return true;
        }

        // Arrow 导航
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          const dir = event.key === 'ArrowUp' ? 'up' : 'down';
          const positions = state!.selectedPositions;

          if (event.shiftKey) {
            // Shift+Arrow: 范围扩展
            const anchor = state!.anchorPos ?? positions[0];
            // 找当前扩展的边界
            const edge = dir === 'down'
              ? Math.max(...positions)
              : Math.min(...positions);
            const next = getAdjacentBlockPos(view.state.doc, edge, dir);
            if (next === null) return true;
            const range = getBlockRange(view.state.doc, anchor, next);
            view.dispatch(view.state.tr.setMeta(blockSelectionKey, {
              active: true, selectedPositions: range, anchorPos: anchor,
            }));
          } else {
            // Arrow 无 Shift: 单选导航
            const current = dir === 'down'
              ? positions[positions.length - 1]
              : positions[0];
            const next = getAdjacentBlockPos(view.state.doc, current, dir);
            if (next === null) return true;
            view.dispatch(view.state.tr.setMeta(blockSelectionKey, {
              active: true, selectedPositions: [next], anchorPos: next,
            }));
          }
          return true;
        }

        // Tab / Shift+Tab → 批量缩进
        if (event.key === 'Tab') {
          event.preventDefault();
          const positions = state!.selectedPositions;
          const tr = view.state.tr;
          const delta = event.shiftKey ? -1 : 1;
          for (const pos of positions) {
            const node = tr.doc.nodeAt(pos);
            if (node && node.attrs.indent !== undefined) {
              const newIndent = Math.max(0, Math.min(8, (node.attrs.indent || 0) + delta));
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: newIndent });
            }
          }
          view.dispatch(tr);
          return true;
        }

        // Delete / Backspace → 删除选中 block
        if (event.key === 'Backspace' || event.key === 'Delete') {
          deleteSelectedBlocks(view, state!.selectedPositions);
          return true;
        }

        // Cmd+C / Cmd+X 由 handleDOMEvents 中的 copy/cut 处理
        // 这里拦截以防止 ProseMirror 默认行为
        if ((event.metaKey || event.ctrlKey) && (event.key === 'c' || event.key === 'x')) {
          return false; // 让 DOM copy/cut 事件正常触发
        }

        // 其他可打印字符 → 退出选中
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
          const firstPos = state!.selectedPositions[0];
          exitSelection(view);
          try {
            const tr = view.state.tr.setSelection(
              TextSelection.near(view.state.doc.resolve(firstPos + 1))
            );
            view.dispatch(tr);
          } catch {}
          return false; // 让字符正常输入
        }

        return false;
      },

      handleDOMEvents: {
        mousedown(view, event) {
          const state = blockSelectionKey.getState(view.state);
          if (!state?.active) return false;

          // 右键：保持选中（留给 ContextMenu）
          if (event.button === 2) return false;

          // Shift+Click: 从 anchor 到点击位置范围选中
          if (event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();

            const posAtCoords = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (!posAtCoords) return true;

            const clickedBlock = findTopBlockPos(view.state.doc, posAtCoords.pos);
            if (clickedBlock === null) return true;

            const anchor = state.anchorPos ?? state.selectedPositions[0];
            if (anchor == null) return true;

            const range = getBlockRange(view.state.doc, anchor, clickedBlock);
            if (range.length > 0) {
              view.dispatch(view.state.tr.setMeta(blockSelectionKey, {
                active: true, selectedPositions: range, anchorPos: anchor,
              }));
            }
            return true;
          }

          // 普通点击: 退出选中
          exitSelection(view);
          return false;
        },
        // 注：复制/剪切/粘贴交给 smart-paste-plugin 的统一通道处理。
        // smart-paste 会读 blockSelectionKey 状态，把 selectedPositions 转换成
        // 一个完整的 PM Slice（覆盖最早 → 最晚 position 的范围，includeParents=true
        // 自然保留所有外层容器），然后走 internal-clipboard JSON 序列化。
        // 单一通道，无白名单，新增节点类型自动支持。
      },
    },
  });
}

// ── 操作函数 ──

function enterSelection(view: EditorView, pos: number) {
  view.dispatch(view.state.tr.setMeta(blockSelectionKey, {
    active: true,
    selectedPositions: [pos],
    anchorPos: pos,
  }));
  view.dom.classList.add('block-selection-active');
}

function exitSelection(view: EditorView) {
  view.dispatch(view.state.tr.setMeta(blockSelectionKey, INITIAL));
  view.dom.classList.remove('block-selection-active');
}

function deleteSelectedBlocks(view: EditorView, positions: number[]) {
  const sorted = [...positions].sort((a, b) => b - a); // 从后往前删
  let tr = view.state.tr;
  for (const pos of sorted) {
    const node = tr.doc.nodeAt(pos);
    if (node) {
      tr.delete(pos, pos + node.nodeSize);
    }
  }
  // 确保文档不为空——至少保留一个空段落
  if (tr.doc.childCount === 0) {
    tr.insert(0, view.state.schema.nodes.textBlock.create());
  }
  tr.setMeta(blockSelectionKey, INITIAL);
  view.dispatch(tr);
  view.dom.classList.remove('block-selection-active');
}
