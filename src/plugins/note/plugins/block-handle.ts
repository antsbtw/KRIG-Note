import { Plugin, PluginKey, TextSelection, NodeSelection } from 'prosemirror-state';
import { Slice, Fragment } from 'prosemirror-model';
import { dropPoint } from 'prosemirror-transform';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { blockSelectionKey } from './block-selection';
import { blockRegistry } from '../registry';
import {
  computeSliceForClipboard,
  writeKrigDataToTransfer,
  readKrigDataFromTransfer,
  KRIG_SOURCE_POS_MIME,
} from '../paste/internal-clipboard';

/** 任意注册为容器（content: block+ 风格，有 containerRule）的 block 类型名 */
function isContainerType(name: string): boolean {
  const def = blockRegistry.get(name);
  return !!def?.containerRule;
}

/**
 * 找到鼠标位置对应的"手柄目标 block"的 depth。
 *
 * 规则：从 $pos 最深处向上，找第一个 block 节点，其直接父节点是 doc 或容器。
 * 这样嵌套容器内的子 block 也能显示自己的手柄。
 *
 * 注意：本函数只处理 posAtCoords 已经正确钻入子 block 的情况。
 * posAtCoords 有时给出容器层级的 pos（鼠标在行高外、margin 区等），此时
 * 上层需要用 DOM 命中测试回退（见 pickChildByY）。
 */
function findHandleTargetDepth($pos: import('prosemirror-model').ResolvedPos): number {
  for (let d = $pos.depth; d >= 1; d--) {
    const node = $pos.node(d);
    if (node.isInline || node.type.name === 'text') continue;
    const parent = $pos.node(d - 1);
    if (parent.type.name === 'doc' || isContainerType(parent.type.name)) {
      return d;
    }
  }
  return 1;
}

/**
 * 当 posAtCoords 给出容器层级的 pos（没钻进子 block），按鼠标 Y 从容器的子 block
 * 中挑选包含该 Y 的那个。递归处理嵌套容器。
 *
 * 返回 { start, node, dom } 或 null（没找到）。
 */
function pickChildByY(
  view: EditorView,
  containerStart: number,
  containerNode: PMNode,
  mouseY: number,
): { start: number; node: PMNode; dom: HTMLElement } | null {
  let offset = containerStart + 1; // 进入容器内部
  for (let i = 0; i < containerNode.childCount; i++) {
    const child = containerNode.child(i);
    const childStart = offset;
    try {
      const dom = view.nodeDOM(childStart);
      const el = dom instanceof HTMLElement ? dom : (dom as Node)?.parentElement;
      if (el) {
        const r = el.getBoundingClientRect();
        if (mouseY >= r.top && mouseY <= r.bottom) {
          // 命中；若 child 自己也是容器，递归钻入
          if (isContainerType(child.type.name)) {
            const deeper = pickChildByY(view, childStart, child, mouseY);
            if (deeper) return deeper;
          }
          return { start: childStart, node: child, dom: el };
        }
      }
    } catch { /* skip */ }
    offset += child.nodeSize;
  }
  return null;
}

/**
 * Block Handle Plugin — 鼠标悬停 Block 时显示手柄（+ ⠿）
 *
 * + → 在下方插入新 paragraph
 * ⠿ 拖拽 → HTML5 native drag 移动 block
 * ⠿ 单击 → 弹出 HandleMenu（通过 CustomEvent）
 */

export const blockHandleKey = new PluginKey('blockHandle');

/** RenderBlock 类型集合 — coordsAtPos 会指向 caption 底部，需特殊处理 */
const RENDER_BLOCK_TYPES = new Set(['image', 'audioBlock', 'videoBlock', 'tweetBlock', 'fileBlock', 'externalRef']);

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
 * 解析 drop 目标。
 *
 * 规则：
 * - 若 drop 落在任意容器（column / toggleList / frameBlock / callout / blockquote / 列表
 *   / tableCell / taskItem 等，凡有 containerRule）内部 → 'nested'，insertPos 是
 *   容器内精确的子 block 插入点
 * - 否则 → 'top'，pos 是顶层 block 起始位置
 *
 * 找最近的容器祖先：从 $pos 最深处向上，第一个 containerRule 容器就是 drop 目标容器。
 */
/**
 * 解析 drop 目标。使用 prosemirror-transform 的 dropPoint 算法，保证与原生
 * dropCursor 的视觉标注位置完全一致（标注线画哪，就插哪）。
 */
function resolveDropTarget(
  doc: PMNode,
  pos: number,
  sourceNode: PMNode,
): { insertPos: number } | null {
  const slice = new Slice(Fragment.from(sourceNode), 0, 0);
  const p = dropPoint(doc, pos, slice);
  if (p == null) return null;
  return { insertPos: p };
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

    // 拖拽开始 — 走与复制粘贴统一的 internal-clipboard 通道：
    //   1. computeSliceForClipboard 拿到完整 Slice（保留所有外层容器）
    //   2. writeKrigDataToTransfer 写 text/html（含 KRIG marker）+ text/plain
    //   3. 额外写 KRIG_SOURCE_POS_MIME 标记源位置范围，drop 时用来删除原位置
    dragBtn.addEventListener('dragstart', (e) => {
      if (currentPos < 0 || !e.dataTransfer) return;
      isDragging = true;

      // 最小化拖拽预览图
      const ghost = document.createElement('div');
      ghost.style.cssText = 'position:absolute;top:-1000px;width:1px;height:1px;';
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 0, 0);
      setTimeout(() => document.body.removeChild(ghost), 0);

      // 如果当前 block 不在 block-selection 选中列表里，临时把 selection 设成当前块
      // —— 让 computeSliceForClipboard 走 PM NodeSelection 路径取到这一块的完整 Slice。
      const bsState = blockSelectionKey.getState(view.state);
      const inMultiSelection = bsState?.active
        && bsState.selectedPositions.length > 0
        && bsState.selectedPositions.includes(currentPos);

      let sliceState = view.state;
      if (!inMultiSelection) {
        const node = view.state.doc.nodeAt(currentPos);
        if (!node) return;
        // 临时构造一个只覆盖当前节点的 NodeSelection，只用于序列化
        try {
          const tr = view.state.tr.setSelection(
            NodeSelection.create(view.state.doc, currentPos),
          );
          sliceState = view.state.apply(tr);
        } catch { /* fallback to current state */ }
      }

      const slice = computeSliceForClipboard(sliceState);
      if (!slice || slice.size === 0) return;

      writeKrigDataToTransfer(e.dataTransfer, slice, view.state.schema);

      // 记录源位置范围（dataTransfer 是进程内对象，自定义 MIME 安全可用）
      const sourceRange = inMultiSelection
        ? bsState!.selectedPositions
        : [currentPos];
      e.dataTransfer.setData(KRIG_SOURCE_POS_MIME, JSON.stringify(sourceRange));
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
          // probeX 选择：
          // view.dom 有左 padding 72px（gutter 区），文字区起点 ≈ editorRect.left + 72
          // - 鼠标在文字区内 → 用鼠标 X（为了 column 内精确定位到对应列）
          // - 鼠标在 gutter / 文字区外（用户去够左侧 handle）→ 钳制到文字区内部一点，
          //   避免 posAtCoords 把 gutter 坐标 snap 到容器层级（toggleList/frameBlock 等），
          //   导致目标跳到外层 block
          const textLeft = editorRect.left + 72;
          const probeX = event.clientX >= textLeft
            ? event.clientX
            : textLeft + 40;
          let blockStart = -1;
          let blockNode: any = null;
          let targetBlockDOM: HTMLElement | null = null;

          const pos = view.posAtCoords({ left: probeX, top: mouseY });
          if (pos) {
            try {
              const $pos = view.state.doc.resolve(pos.pos);
              const targetDepth = findHandleTargetDepth($pos);
              if (targetDepth >= 1) {
                blockStart = $pos.before(targetDepth);
                blockNode = $pos.node(targetDepth);
                const dom = view.nodeDOM(blockStart);
                targetBlockDOM = dom instanceof HTMLElement ? dom : (dom as Node)?.parentElement as HTMLElement ?? null;

                // columnList/column 没有自身手柄，需钻入子 block
                if (blockNode && (blockNode.type.name === 'columnList' || blockNode.type.name === 'column')) {
                  const picked = pickChildByY(view, blockStart, blockNode, mouseY);
                  if (picked) {
                    blockStart = picked.start;
                    blockNode = picked.node;
                    targetBlockDOM = picked.dom;
                  }
                }
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
              // left：手柄水平位置策略
              // - column 内 block：贴 block DOM 左侧 - 52（多列布局必须指向具体一列）
              // - 其他所有情况（顶层 / 单列容器如 toggleList/frameBlock/列表/callout/blockquote 等）：
              //   统一对齐到编辑器左 gutter（editorLeft + 20），与顶层 block 手柄同列，
              //   移动路径不穿过容器内部，目标稳定不抖动
              const editorLeft = view.dom.getBoundingClientRect().left - containerRect.left + container.scrollLeft;
              const isInsideColumn = blockStart >= 0 && (() => {
                try {
                  const $p = view.state.doc.resolve(blockStart);
                  for (let d = $p.depth; d >= 1; d--) {
                    if ($p.node(d).type.name === 'column') return true;
                  }
                  return false;
                } catch { return false; }
              })();

              if (isInsideColumn) {
                const blockLeftPx = blockRect.left - containerRect.left + container.scrollLeft;
                handleDOM.style.left = `${blockLeftPx - 52}px`;
              } else {
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

      // 接收拖放 — 走 internal-clipboard 通道：
      //   1. 从 dataTransfer 读出 KRIG Slice（保留所有外层容器结构）
      //   2. 读出 KRIG_SOURCE_POS_MIME 标记的源位置范围
      //   3. 在目标位置插入 Slice，再删除源位置范围（先插后删，删除位置经 mapping）
      handleDrop(view, event) {
        if (!event.dataTransfer) return false;
        const sourcePosData = event.dataTransfer.getData(KRIG_SOURCE_POS_MIME);
        if (!sourcePosData) return false; // 不是 KRIG 拖拽，让 PM 默认处理

        const slice = readKrigDataFromTransfer(event.dataTransfer, view.state.schema);
        if (!slice || slice.size === 0) return false;

        const dropResult = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!dropResult) return false;

        let sourcePositions: number[];
        try {
          sourcePositions = JSON.parse(sourcePosData);
          if (!Array.isArray(sourcePositions) || sourcePositions.length === 0) return false;
        } catch { return false; }

        // 用 Slice 的第一个 child 类型来推断 drop 目标（容器/兄弟）
        const firstNode = slice.content.firstChild;
        if (!firstNode) return false;
        const target = resolveDropTarget(view.state.doc, dropResult.pos, firstNode);
        if (!target) return false;

        // 自我拖到内部禁用：drop 位置不能落在任何源节点范围内
        for (const srcPos of sourcePositions) {
          const srcNode = view.state.doc.nodeAt(srcPos);
          if (!srcNode) continue;
          if (target.insertPos > srcPos && target.insertPos < srcPos + srcNode.nodeSize) {
            event.preventDefault();
            return true; // 静默忽略
          }
        }

        event.preventDefault();

        const tr = view.state.tr;
        // 先在目标插入 Slice
        tr.insert(target.insertPos, slice.content);
        // 再删源位置范围（位置已经被 insert 影响，用 mapping 还原）
        const sortedSources = [...sourcePositions].sort((a, b) => b - a); // 从后往前删
        for (const srcPos of sortedSources) {
          const mappedPos = tr.mapping.map(srcPos);
          const node = tr.doc.nodeAt(mappedPos);
          if (node) tr.delete(mappedPos, mappedPos + node.nodeSize);
        }
        // 退出 block-selection 状态
        tr.setMeta(blockSelectionKey, { active: false, selectedPositions: [], anchorPos: null });
        view.dispatch(tr);
        return true;
      },
    },
  });
}
