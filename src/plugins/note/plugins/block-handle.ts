import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { blockRegistry } from '../registry';
import { blockAction } from '../block-ops/block-action';

/**
 * Block Handle Plugin（框架级）
 *
 * 鼠标悬停 Block 时显示手柄（⠿）。
 * 单击 → 弹出操作菜单。
 * 按住拖拽 → 移动 Block（显示蓝色放置线）。
 */

export const blockHandleKey = new PluginKey('blockHandle');

export interface BlockHandleState {
  visible: boolean;
  pos: number;
  blockType: string;
  coords: { left: number; top: number } | null;
  menuOpen: boolean;
}

const INITIAL_STATE: BlockHandleState = {
  visible: false,
  pos: 0,
  blockType: '',
  coords: null,
  menuOpen: false,
};

// 拖拽判定：移动超过 5px 才算拖拽，否则算单击
const DRAG_THRESHOLD = 5;

export function blockHandlePlugin(): Plugin {
  let handleDOM: HTMLDivElement | null = null;
  let dropIndicator: HTMLDivElement | null = null;
  let currentState = INITIAL_STATE;
  let isHandleHovered = false;
  let hideTimeout: ReturnType<typeof setTimeout> | null = null;

  // 拖拽状态
  let isDragging = false;
  let dragStartY = 0;
  let dragFromPos = -1;
  let dragTargetPos = -1;

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

    // + 按钮（添加新段落）
    const addBtn = document.createElement('div');
    addBtn.className = 'block-handle__add';
    addBtn.innerHTML = '+';
    addBtn.style.cssText = `
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: #555;
      font-size: 20px;
      border-radius: 3px;
    `;
    addBtn.addEventListener('mouseenter', () => { addBtn.style.background = '#333'; addBtn.style.color = '#e8eaed'; });
    addBtn.addEventListener('mouseleave', () => { addBtn.style.background = 'transparent'; addBtn.style.color = '#555'; });
    addBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // 在当前 Block 之后插入新 paragraph
      const pos = currentState.pos;
      const node = view.state.doc.nodeAt(pos);
      if (node) {
        const insertPos = pos + node.nodeSize;
        const schema = view.state.schema;
        const tr = view.state.tr.insert(insertPos, schema.nodes.paragraph.create());
        const { TextSelection } = require('prosemirror-state');
        tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
        view.dispatch(tr);
        view.focus();
      }
    });

    // ⠿ 拖拽手柄
    const dragBtn = document.createElement('div');
    dragBtn.className = 'block-handle__drag';
    dragBtn.innerHTML = '⠿';
    dragBtn.style.cssText = `
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: grab;
      color: #555;
      font-size: 18px;
      border-radius: 3px;
    `;
    dragBtn.addEventListener('mouseenter', () => { dragBtn.style.background = '#333'; dragBtn.style.color = '#e8eaed'; });
    dragBtn.addEventListener('mouseleave', () => { dragBtn.style.background = 'transparent'; dragBtn.style.color = '#555'; });

    dom.appendChild(addBtn);
    dom.appendChild(dragBtn);

    dom.addEventListener('mouseenter', () => {
      isHandleHovered = true;
      if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
      dom.style.opacity = '1';
    });

    dom.addEventListener('mouseleave', () => {
      isHandleHovered = false;
      if (!currentState.menuOpen && !isDragging) {
        hideTimeout = setTimeout(() => {
          if (!isHandleHovered && !currentState.menuOpen && !isDragging) {
            dom.style.opacity = '0';
          }
        }, 300);
      }
    });

    // dragBtn mousedown → 可能是单击（弹菜单）或拖拽
    dragBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragStartY = e.clientY;
      dragFromPos = currentState.pos;
      isDragging = false;

      const onMouseMove = (me: MouseEvent) => {
        const dy = Math.abs(me.clientY - dragStartY);
        if (dy > DRAG_THRESHOLD && !isDragging) {
          // 开始拖拽
          isDragging = true;
          dom.style.cursor = 'grabbing';
          createDropIndicator(view);
        }
        if (isDragging) {
          updateDropIndicator(view, me.clientY);
        }
      };

      const onMouseUp = (me: MouseEvent) => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        if (isDragging) {
          // 执行移动
          isDragging = false;
          dom.style.cursor = 'grab';
          removeDropIndicator();

          if (dragTargetPos >= 0 && dragFromPos >= 0 && dragTargetPos !== dragFromPos) {
            blockAction.move(view, dragFromPos, dragTargetPos);
          }
        } else {
          // 单击 → 弹出菜单
          setTimeout(() => {
            currentState = { ...currentState, menuOpen: true };
            view.dom.dispatchEvent(new CustomEvent('block-handle-click', {
              detail: {
                pos: currentState.pos,
                blockType: currentState.blockType,
                coords: { left: dom.getBoundingClientRect().left, top: dom.getBoundingClientRect().bottom },
              },
          }));
            // 监听菜单关闭（document click 会关闭菜单）
            const resetMenu = () => {
              setTimeout(() => {
                currentState = { ...currentState, menuOpen: false };
              }, 100);
              document.removeEventListener('click', resetMenu);
            };
            setTimeout(() => document.addEventListener('click', resetMenu), 100);
          }, 50);
        }

        dragFromPos = -1;
        dragTargetPos = -1;
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    view.dom.parentElement?.appendChild(dom);
    return dom;
  }

  // ── Drop Indicator（蓝色放置线） ──

  function createDropIndicator(view: EditorView): void {
    if (dropIndicator) return;
    dropIndicator = document.createElement('div');
    dropIndicator.style.cssText = `
      position: absolute;
      left: 0;
      right: 0;
      height: 2px;
      background: #4a9eff;
      pointer-events: none;
      z-index: 100;
      border-radius: 1px;
    `;
    view.dom.parentElement?.appendChild(dropIndicator);
  }

  function updateDropIndicator(view: EditorView, mouseY: number): void {
    if (!dropIndicator) return;

    const container = view.dom.parentElement;
    const containerRect = container?.getBoundingClientRect();
    if (!containerRect || !container) return;

    // 找到鼠标最近的 Block 间隙
    const doc = view.state.doc;
    let closestGapY = 0;
    let closestGapPos = 0;
    let minDist = Infinity;

    doc.forEach((node, pos) => {
      try {
        const coords = view.coordsAtPos(pos);
        // Block 顶部间隙
        const topY = coords.top;
        const distTop = Math.abs(mouseY - topY);
        if (distTop < minDist) {
          minDist = distTop;
          closestGapY = topY;
          closestGapPos = pos;
        }

        // Block 底部间隙
        const bottomY = coords.top + (view.nodeDOM(pos) as HTMLElement)?.offsetHeight || coords.bottom;
        const distBottom = Math.abs(mouseY - bottomY);
        if (distBottom < minDist) {
          minDist = distBottom;
          closestGapY = bottomY;
          closestGapPos = pos + node.nodeSize;
        }
      } catch { /* ignore */ }
    });

    dropIndicator.style.top = `${closestGapY - containerRect.top + container.scrollTop}px`;
    dragTargetPos = closestGapPos;
  }

  function removeDropIndicator(): void {
    dropIndicator?.remove();
    dropIndicator = null;
  }

  // ── Handle 位置管理 ──

  // 当前追踪的 Block DOM（用于 RAF 持续定位）
  let trackedBlockDOM: HTMLElement | null = null;
  let trackedView: EditorView | null = null;
  let rafId: number | null = null;

  function startTracking(view: EditorView, pos: number): void {
    trackedView = view;
    try {
      const dom = view.nodeDOM(pos);
      trackedBlockDOM = dom instanceof HTMLElement ? dom : (dom as Node)?.parentElement ?? null;
    } catch {
      trackedBlockDOM = null;
    }
    if (!rafId) rafLoop();
  }

  function rafLoop(): void {
    if (!handleDOM) return;

    if (isHandleHovered || currentState.menuOpen) {
      // Handle 被 hover 或菜单打开时，保持当前位置不变
      rafId = requestAnimationFrame(rafLoop);
      return;
    }

    if (trackedBlockDOM && currentState.visible) {
      const container = handleDOM.parentElement;
      const containerRect = container?.getBoundingClientRect();
      if (containerRect && container && trackedView) {
        const blockRect = trackedBlockDOM.getBoundingClientRect();
        const scrollTop = container.scrollTop;
        const handleHeight = 24;

        // 框体类 block（有边框/背景的）→ 手柄与框顶部对齐
        const isBoxBlock = trackedBlockDOM.classList.contains('render-block')
          || trackedBlockDOM.classList.contains('code-block');

        let topPx: number;
        if (isBoxBlock) {
          topPx = blockRect.top - containerRect.top + scrollTop + 8;
        } else {
          // 文字类 block → 手柄与第一行文字垂直居中
          let textTop = blockRect.top;
          let lineHeight = 27;
          try {
            const coords = trackedView.coordsAtPos(currentState.pos + 1);
            if (coords.top >= blockRect.top && coords.top <= blockRect.bottom) {
              textTop = coords.top;
              lineHeight = coords.bottom - coords.top;
            }
          } catch { /* fallback */ }
          topPx = textTop - containerRect.top + scrollTop + (lineHeight - handleHeight) / 2;
        }

        handleDOM.style.left = `${blockRect.left - containerRect.left + container.scrollLeft - 62}px`;
        handleDOM.style.top = `${topPx}px`;
        handleDOM.style.opacity = '1';
      }
    }

    rafId = requestAnimationFrame(rafLoop);
  }

  function stopTracking(): void {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    trackedBlockDOM = null;
  }

  function hideHandle(): void {
    if (handleDOM && !currentState.menuOpen && !isHandleHovered && !isDragging) {
      hideTimeout = setTimeout(() => {
        if (!isHandleHovered && !currentState.menuOpen && !isDragging && handleDOM) {
          handleDOM.style.opacity = '0';
        }
      }, 100);
    }
  }

  return new Plugin({
    key: blockHandleKey,

    view(editorView) {
      handleDOM = createHandleDOM(editorView);
      return {
        update() {},
        destroy() {
          stopTracking();
          handleDOM?.remove();
          handleDOM = null;
          removeDropIndicator();
        },
      };
    },

    props: {
      handleDOMEvents: {
        mousemove(view, event) {
          if (isHandleHovered || isDragging) return false;

          // 从 DOM 向上查找 doc 的直接子节点（depth=1）
          let target = event.target as HTMLElement | null;
          const pmDOM = view.dom;
          let blockDOM: HTMLElement | null = null;
          while (target && target !== pmDOM) {
            if (target.parentElement === pmDOM) {
              blockDOM = target;
              break;
            }
            target = target.parentElement;
          }
          if (!blockDOM) { hideHandle(); return false; }

          // 从 DOM 反查 ProseMirror pos
          let blockStart: number;
          let topNode: any;
          try {
            const innerPos = view.posAtDOM(blockDOM, 0);
            const $pos = view.state.doc.resolve(innerPos);
            if ($pos.depth < 1) { hideHandle(); return false; }
            blockStart = $pos.before(1);
            topNode = $pos.node(1);
          } catch { hideHandle(); return false; }
          if (!topNode) { hideHandle(); return false; }

          // noteTitle（isTitle=true）不显示手柄
          if (topNode.type.name === 'textBlock' && topNode.attrs.isTitle) {
            hideHandle();
            return false;
          }

          const blockDef = blockRegistry.get(topNode.type.name);
          if (blockDef && blockDef.capabilities.canDrag === false && blockDef.capabilities.canDelete === false) {
            hideHandle();
            return false;
          }

          if (currentState.pos === blockStart && currentState.visible) return false;

          if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }

          currentState = {
            visible: true,
            pos: blockStart,
            blockType: topNode.type.name,
            coords: null,
            menuOpen: currentState.menuOpen,
          };

          startTracking(view, blockStart);
          return false;
        },

        mouseleave() {
          hideHandle();
          return false;
        },
      },
    },
  });
}
