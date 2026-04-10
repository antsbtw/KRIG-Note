import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Slice, Fragment } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { blockSelectionKey } from './block-selection';

/**
 * Block Handle Plugin — 鼠标悬停 Block 时显示手柄（+ ⠿）
 *
 * + → 在下方插入新 paragraph
 * ⠿ 拖拽 → HTML5 native drag 移动 block
 * ⠿ 单击 → 弹出 HandleMenu（通过 CustomEvent）
 */

export const blockHandleKey = new PluginKey('blockHandle');

/** RenderBlock 类型集合 — coordsAtPos 会指向 caption 底部，需特殊处理 */
const RENDER_BLOCK_TYPES = new Set(['image', 'audioBlock', 'videoBlock', 'tweetBlock']);

/** 找到 pos 所在的顶层 block 起始位置 */
export function findTopBlockPos(doc: PMNode, pos: number): number | null {
  let result: number | null = null;
  doc.forEach((node, offset) => {
    if (result !== null) return;
    if (pos >= offset && pos < offset + node.nodeSize) {
      result = offset;
    }
  });
  return result;
}

/**
 * 解析 drop 目标：判断是顶层还是 column 内部。
 * 返回 { type: 'top', pos } 或 { type: 'column', insertPos } 。
 * insertPos 是 column 内精确的插入位置（某个子 block 之前）。
 */
function resolveDropTarget(doc: PMNode, pos: number): { type: 'top'; pos: number } | { type: 'column'; insertPos: number } | null {
  try {
    const $pos = doc.resolve(pos);
    // 向上查找是否在 column 内
    for (let d = $pos.depth; d >= 1; d--) {
      if ($pos.node(d).type.name === 'column') {
        // 找到 column，计算 column 内子 block 层级的插入位置
        // column 的子 block 在 depth = d + 1
        const childDepth = d + 1;
        if ($pos.depth >= childDepth) {
          // 光标在某个子 block 内部，插入到该子 block 之前
          return { type: 'column', insertPos: $pos.before(childDepth) };
        } else {
          // 光标在 column 层但不在子 block 内，插入到 column 末尾
          return { type: 'column', insertPos: $pos.end(d) };
        }
      }
    }
  } catch { /* fall through */ }
  // 不在 column 内，回退到顶层
  const topPos = findTopBlockPos(doc, pos);
  if (topPos === null) return null;
  return { type: 'top', pos: topPos };
}

/**
 * 将 block 从 fromPos（任意层级）移动到 insertPos（任意层级）。
 * 通用版本：直接删除源节点，插入到目标位置。
 */
function relocateBlockGeneral(view: EditorView, fromPos: number, insertPos: number): boolean {
  const { state } = view;
  const node = state.doc.nodeAt(fromPos);
  if (!node) return false;

  // 不能自己移到自己内部
  if (insertPos > fromPos && insertPos < fromPos + node.nodeSize) return false;

  // 检查目标位置的 parent 是否允许此节点类型
  try {
    const $insert = state.doc.resolve(insertPos);
    const parentNode = $insert.parent;
    if (!parentNode.type.contentMatch.matchType(node.type)) return false;
  } catch { return false; }

  // 检查是否原位（紧挨着源节点前后）
  if (insertPos === fromPos || insertPos === fromPos + node.nodeSize) return false;

  const tr = state.tr;
  if (insertPos < fromPos) {
    // 先插后删（避免位置偏移）
    tr.insert(insertPos, node);
    const mappedFrom = tr.mapping.map(fromPos);
    const mappedNode = tr.doc.nodeAt(mappedFrom);
    if (mappedNode) tr.delete(mappedFrom, mappedFrom + mappedNode.nodeSize);
  } else {
    // 先删后插
    tr.delete(fromPos, fromPos + node.nodeSize);
    const mappedInsert = tr.mapping.map(insertPos);
    tr.insert(mappedInsert, node);
  }
  view.dispatch(tr);
  return true;
}

/** 将 block 从 fromPos 移动到 targetPos（仅顶层 block 之间） */
function relocateBlock(view: EditorView, fromPos: number, targetPos: number): boolean {
  const { state } = view;
  const node = state.doc.nodeAt(fromPos);
  if (!node) return false;

  // 不能自己移到自己内部
  if (targetPos > fromPos && targetPos < fromPos + node.nodeSize) return false;

  // 获取所有顶层 block 位置
  const allPositions: number[] = [];
  state.doc.forEach((_n: PMNode, offset: number) => allPositions.push(offset));

  const sourceIdx = allPositions.indexOf(fromPos);
  if (sourceIdx < 0) return false;

  let targetIdx = allPositions.findIndex(p => p >= targetPos);
  if (targetIdx < 0) targetIdx = allPositions.length;

  // 已经在原位
  if (targetIdx === sourceIdx || targetIdx === sourceIdx + 1) return false;

  const tr = state.tr;
  // 先删除源 block
  tr.delete(fromPos, fromPos + node.nodeSize);
  // 映射目标位置
  const mappedTarget = tr.mapping.map(allPositions[targetIdx] ?? targetPos);
  // 插入到目标位置
  tr.replace(mappedTarget, mappedTarget, new Slice(Fragment.from(node), 0, 0));
  view.dispatch(tr);
  return true;
}

/** 将多个 block 从 positions 移动到 targetPos */
function relocateBlocks(view: EditorView, positions: number[], targetPos: number): boolean {
  const { state } = view;
  const allPositions: number[] = [];
  state.doc.forEach((_n: PMNode, offset: number) => allPositions.push(offset));

  // 去重排序
  const sorted = Array.from(new Set(positions)).sort((a, b) => a - b);

  // 不能移到自己内部
  for (const pos of sorted) {
    const node = state.doc.nodeAt(pos);
    if (node && targetPos > pos && targetPos < pos + node.nodeSize) return false;
  }

  // 收集节点
  const nodes = sorted.map(p => state.doc.nodeAt(p)).filter(Boolean) as PMNode[];
  if (nodes.length === 0) return false;

  // 检查是否原位
  const sourceIndices = sorted.map(p => allPositions.indexOf(p)).filter(i => i >= 0);
  let targetIdx = allPositions.findIndex(p => p >= targetPos);
  if (targetIdx < 0) targetIdx = allPositions.length;
  const firstSrcIdx = sourceIndices[0];
  const lastSrcIdx = sourceIndices[sourceIndices.length - 1];
  if (targetIdx >= firstSrcIdx && targetIdx <= lastSrcIdx + 1) return false;

  const tr = state.tr;
  // 从后往前删除
  for (let i = sorted.length - 1; i >= 0; i--) {
    const node = state.doc.nodeAt(sorted[i]);
    if (node) tr.delete(sorted[i], sorted[i] + node.nodeSize);
  }
  const mappedTarget = tr.mapping.map(allPositions[targetIdx] ?? targetPos);
  tr.replace(mappedTarget, mappedTarget, new Slice(Fragment.from(nodes), 0, 0));

  // 计算移动后的新位置，保持选中状态
  const newPositions: number[] = [];
  let offset = mappedTarget;
  for (const node of nodes) {
    newPositions.push(offset);
    offset += node.nodeSize;
  }
  tr.setMeta(blockSelectionKey, {
    active: true,
    selectedPositions: newPositions,
    anchorPos: newPositions[0],
  });

  view.dispatch(tr);
  return true;
}

export function blockHandlePlugin(): Plugin {
  let handleDOM: HTMLDivElement | null = null;
  let currentPos = -1;
  let currentBlockType = '';
  let isHovered = false;
  let hideTimeout: ReturnType<typeof setTimeout> | null = null;
  let isDragging = false;

  function createHandleDOM(view: EditorView): HTMLDivElement {
    const dom = document.createElement('div');
    dom.className = 'block-handle';
    dom.style.cssText = `
      position: absolute;
      display: flex;
      align-items: center;
      gap: 0;
      opacity: 0;
      transition: opacity 0.15s;
      z-index: 10;
      user-select: none;
    `;

    // + 按钮
    const addBtn = document.createElement('div');
    addBtn.className = 'block-handle__add';
    addBtn.innerHTML = '+';
    addBtn.style.cssText = `
      width: 24px; height: 24px;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; color: #555; font-size: 20px; border-radius: 3px;
    `;
    addBtn.addEventListener('mouseenter', () => { addBtn.style.background = '#333'; addBtn.style.color = '#e8eaed'; });
    addBtn.addEventListener('mouseleave', () => { addBtn.style.background = 'transparent'; addBtn.style.color = '#555'; });
    addBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const node = view.state.doc.nodeAt(currentPos);
      if (node) {
        const insertPos = currentPos + node.nodeSize;
        const tr = view.state.tr.insert(insertPos, view.state.schema.nodes.textBlock.create());
        tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
        view.dispatch(tr);
        view.focus();
      }
    });

    // ⠿ 拖拽/菜单按钮
    const dragBtn = document.createElement('div');
    dragBtn.className = 'block-handle__drag';
    dragBtn.innerHTML = '⠿';
    dragBtn.draggable = true;
    dragBtn.style.cssText = `
      width: 24px; height: 24px;
      display: flex; align-items: center; justify-content: center;
      cursor: grab; color: #555; font-size: 18px; border-radius: 3px;
    `;
    dragBtn.addEventListener('mouseenter', () => { dragBtn.style.background = '#333'; dragBtn.style.color = '#e8eaed'; });
    dragBtn.addEventListener('mouseleave', () => { if (!isDragging) { dragBtn.style.background = 'transparent'; dragBtn.style.color = '#555'; } });

    // 拖拽开始
    dragBtn.addEventListener('dragstart', (e) => {
      if (currentPos < 0 || !e.dataTransfer) return;
      isDragging = true;

      // 最小化拖拽预览图
      const ghost = document.createElement('div');
      ghost.style.cssText = 'position:absolute;top:-1000px;width:1px;height:1px;';
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 0, 0);
      setTimeout(() => document.body.removeChild(ghost), 0);

      // 检查 block-selection：如果当前 block 在选中列表中，拖拽所有选中 block
      const bsState = blockSelectionKey.getState(view.state);
      if (bsState?.active && bsState.selectedPositions.length > 1
          && bsState.selectedPositions.includes(currentPos)) {
        e.dataTransfer.setData(
          'application/krig-multi-block',
          JSON.stringify(bsState.selectedPositions),
        );
      } else {
        e.dataTransfer.setData('application/krig-block-pos', String(currentPos));
      }
      e.dataTransfer.effectAllowed = 'move';
    });

    dragBtn.addEventListener('dragend', () => {
      isDragging = false;
      dragBtn.style.background = 'transparent';
      dragBtn.style.color = '#555';
    });

    // 单击 → 弹出菜单（只在非拖拽时触发）
    let mouseDownTime = 0;
    dragBtn.addEventListener('mousedown', () => {
      mouseDownTime = Date.now();
    });
    dragBtn.addEventListener('click', (e) => {
      // 如果按下时间 < 200ms，视为单击（不是拖拽）
      if (Date.now() - mouseDownTime > 200) return;
      e.preventDefault();
      e.stopPropagation();
      view.dom.dispatchEvent(new CustomEvent('block-handle-click', {
        detail: { pos: currentPos, blockType: currentBlockType, coords: { left: dom.getBoundingClientRect().left, top: dom.getBoundingClientRect().bottom } },
      }));
    });

    dom.appendChild(addBtn);
    dom.appendChild(dragBtn);

    dom.addEventListener('mouseenter', () => {
      isHovered = true;
      if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
      dom.style.opacity = '1';
    });
    dom.addEventListener('mouseleave', () => {
      isHovered = false;
      hideTimeout = setTimeout(() => { if (!isHovered && handleDOM) handleDOM.style.opacity = '0'; }, 300);
    });

    view.dom.parentElement?.appendChild(dom);
    return dom;
  }

  function hideHandle() {
    if (handleDOM && !isHovered) {
      hideTimeout = setTimeout(() => { if (!isHovered && handleDOM) handleDOM.style.opacity = '0'; }, 100);
    }
  }

  return new Plugin({
    key: blockHandleKey,

    view(editorView) {
      handleDOM = createHandleDOM(editorView);
      return {
        destroy() {
          if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
          handleDOM?.remove(); handleDOM = null;
        },
      };
    },

    props: {
      handleDOMEvents: {
        mousemove(view, event) {
          if (isHovered || isDragging) return false;

          // ══════════════════════════════════════════════════
          // 手柄定位逻辑
          // ══════════════════════════════════════════════════

          const editorRect = view.dom.getBoundingClientRect();
          if (event.clientX < editorRect.left - 70 || event.clientX > editorRect.right + 10) {
            hideHandle(); return false;
          }

          const mouseY = event.clientY;
          // 用鼠标实际 X 坐标探测，这样能精确进入 column 内的子 block
          const probeX = event.clientX;
          let blockStart = -1;
          let blockNode: any = null;
          let targetBlockDOM: HTMLElement | null = null;

          const pos = view.posAtCoords({ left: probeX, top: mouseY });
          if (pos) {
            try {
              const $pos = view.state.doc.resolve(pos.pos);
              let depth = $pos.depth;
              while (depth > 0 && ($pos.node(depth).isInline || $pos.node(depth).type.name === 'text')) depth--;

              // 如果在 column 内部，钻入到 column 的直接子 block
              // 结构: doc > columnList > column > textBlock
              // 我们要定位到 column 的子 block（depth 对应 column 的子节点层）
              if (depth >= 1) {
                // 检查是否在 column 内部：向上找 column 祖先
                let targetDepth = depth;
                for (let d = depth; d >= 1; d--) {
                  const ancestor = $pos.node(d);
                  if (ancestor.type.name === 'column') {
                    // 定位到 column 的直接子节点（depth = d + 1）
                    if (depth > d) {
                      targetDepth = d + 1;
                    }
                    break;
                  }
                  // 如果碰到 columnList 但没碰到 column，说明光标在 columnList 层级但不在 column 内
                  if (ancestor.type.name === 'columnList') break;
                }

                // 对于非 column 场景，回退到顶层 block（depth=1）
                if (targetDepth > 1) {
                  // 在 column 内：用 targetDepth
                  let inColumn = false;
                  for (let d = targetDepth; d >= 1; d--) {
                    if ($pos.node(d).type.name === 'column') { inColumn = true; break; }
                  }
                  if (!inColumn) targetDepth = 1;
                }

                blockStart = $pos.before(targetDepth);
                blockNode = $pos.node(targetDepth);
                const dom = view.nodeDOM(blockStart);
                targetBlockDOM = dom instanceof HTMLElement ? dom : (dom as Node)?.parentElement as HTMLElement ?? null;
              }
            } catch { /* ignore */ }
          }

          if (blockStart < 0) {
            const children = view.dom.children;
            let minDist = Infinity;
            for (let i = 0; i < children.length; i++) {
              const child = children[i] as HTMLElement;
              const rect = child.getBoundingClientRect();
              if (mouseY >= rect.top && mouseY <= rect.bottom) {
                try {
                  const p = view.posAtDOM(child, 0);
                  const $p = view.state.doc.resolve(p);
                  blockStart = $p.before(1);
                  blockNode = $p.node(1);
                  targetBlockDOM = child;
                } catch { /* ignore */ }
                break;
              }
              const dist = mouseY < rect.top ? rect.top - mouseY : mouseY - rect.bottom;
              if (dist < minDist && dist < 20) {
                minDist = dist;
                try {
                  const p = view.posAtDOM(child, 0);
                  const $p = view.state.doc.resolve(p);
                  blockStart = $p.before(1);
                  blockNode = $p.node(1);
                  targetBlockDOM = child;
                } catch { /* ignore */ }
              }
            }
          }

          if (blockStart < 0 || !blockNode || !targetBlockDOM) { hideHandle(); return false; }
          if (blockNode.type.name === 'textBlock' && blockNode.attrs.isTitle) { hideHandle(); return false; }
          // 不在 columnList / column 自身上显示手柄，只在其子 block 上
          if (blockNode.type.name === 'columnList' || blockNode.type.name === 'column') { hideHandle(); return false; }

          if (currentPos === blockStart) return false;
          currentPos = blockStart;
          currentBlockType = blockNode.type.name;

          if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }

          if (handleDOM) {
            const container = handleDOM.parentElement;
            const containerRect = container?.getBoundingClientRect();
            if (containerRect && container) {
              const blockRect = targetBlockDOM.getBoundingClientRect();
              const scrollTop = container.scrollTop;
              const handleHeight = 24;

              let textTop = blockRect.top;
              let lineHeight = 27;
              // render-block（含 caption）的 blockStart+1 指向 caption 在底部，
              // 直接用 blockRect.top 对齐顶部
              if (!RENDER_BLOCK_TYPES.has(blockNode.type.name)) {
                try {
                  const coords = view.coordsAtPos(blockStart + 1);
                  if (coords.top >= blockRect.top && coords.top <= blockRect.bottom) {
                    textTop = coords.top;
                    lineHeight = coords.bottom - coords.top;
                  }
                } catch { /* fallback */ }
              }

              const topPx = textTop - containerRect.top + scrollTop + (lineHeight - handleHeight) / 2;
              // left：保持手柄和文字的相对距离一致
              // 普通 block：editorLeft + 20，文字从 editorLeft + 72 开始 → 差 52px
              // column 内 block：用 block DOM 的 left - 52，保持同样的视觉距离
              const editorLeft = view.dom.getBoundingClientRect().left - containerRect.left + container.scrollLeft;
              const isInsideColumn = blockStart >= 0 && (() => {
                try {
                  const $p = view.state.doc.resolve(blockStart);
                  for (let d = $p.depth; d >= 1; d--) {
                    if ($p.node(d).type.name === 'column') return true;
                  }
                } catch {}
                return false;
              })();

              if (isInsideColumn) {
                // column 内 block：手柄紧贴 block 文字左侧（叠加在文字上）
                const blockLeftPx = blockRect.left - containerRect.left + container.scrollLeft;
                handleDOM.style.left = `${blockLeftPx - 52}px`;
              } else {
                // 普通 block：固定在编辑器左边缘
                handleDOM.style.left = `${editorLeft + 20}px`;
              }
              handleDOM.style.top = `${topPx}px`;
              handleDOM.style.opacity = '1';
            }
          }

          return false;
        },
        mouseleave() { hideHandle(); return false; },
        dragover(view, event) {
          // 允许外部拖拽（block handle）放入编辑器，同时触发 dropCursor 显示对齐线
          if (isDragging) {
            event.preventDefault();
          }
          return false;
        },
      },

      // 接收拖放
      handleDrop(view, event) {
        const dropResult = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!dropResult) return false;

        const target = resolveDropTarget(view.state.doc, dropResult.pos);
        if (!target) return false;

        // 多 block 拖拽
        const multiData = event.dataTransfer?.getData('application/krig-multi-block');
        if (multiData) {
          event.preventDefault();
          try {
            const positions: number[] = JSON.parse(multiData);
            if (Array.isArray(positions) && positions.length > 0) {
              if (target.type === 'column') {
                // 多 block 拖入 column：逐个移入（从后往前以保持顺序）
                let success = false;
                const sorted = [...positions].sort((a, b) => a - b);
                for (let i = sorted.length - 1; i >= 0; i--) {
                  if (relocateBlockGeneral(view, sorted[i], target.insertPos)) success = true;
                }
                return success;
              }
              return relocateBlocks(view, positions, target.pos);
            }
          } catch {}
          return false;
        }

        // 单 block 拖拽
        const posData = event.dataTransfer?.getData('application/krig-block-pos');
        if (!posData) return false;
        event.preventDefault();
        const fromPos = parseInt(posData, 10);
        if (isNaN(fromPos)) return false;

        if (target.type === 'column') {
          return relocateBlockGeneral(view, fromPos, target.insertPos);
        }
        // 源 block 可能在 column 内部（嵌套位置），此时用通用版本
        const isSourceNested = (() => {
          try {
            const $from = view.state.doc.resolve(fromPos);
            return $from.depth > 1;
          } catch { return false; }
        })();
        if (isSourceNested) {
          return relocateBlockGeneral(view, fromPos, target.pos);
        }
        return relocateBlock(view, fromPos, target.pos);
      },
    },
  });
}
