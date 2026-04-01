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
    dom.innerHTML = '⠿';
    dom.style.cssText = `
      position: absolute;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: grab;
      color: #555;
      font-size: 16px;
      border-radius: 4px;
      user-select: none;
      opacity: 0;
      transition: opacity 0.15s;
      z-index: 10;
    `;

    dom.addEventListener('mouseenter', () => {
      isHandleHovered = true;
      if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
      dom.style.background = '#333';
      dom.style.color = '#e8eaed';
      dom.style.opacity = '1';
    });

    dom.addEventListener('mouseleave', () => {
      isHandleHovered = false;
      if (!currentState.menuOpen && !isDragging) {
        dom.style.background = 'transparent';
        dom.style.color = '#555';
        hideTimeout = setTimeout(() => {
          if (!isHandleHovered && !currentState.menuOpen && !isDragging) {
            dom.style.opacity = '0';
          }
        }, 300);
      }
    });

    // mousedown → 可能是单击或拖拽
    dom.addEventListener('mousedown', (e) => {
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
          // 单击 → 弹出菜单（延迟，避免被 document click close handler 立即关闭）
          setTimeout(() => {
            currentState = { ...currentState, menuOpen: !currentState.menuOpen };
            view.dom.dispatchEvent(new CustomEvent('block-handle-click', {
              detail: {
                pos: currentState.pos,
                blockType: currentState.blockType,
                coords: { left: dom.getBoundingClientRect().left, top: dom.getBoundingClientRect().bottom },
              },
          }));
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

    const containerRect = view.dom.parentElement?.getBoundingClientRect();
    if (!containerRect) return;

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

    dropIndicator.style.top = `${closestGapY - containerRect.top}px`;
    dragTargetPos = closestGapPos;
  }

  function removeDropIndicator(): void {
    dropIndicator?.remove();
    dropIndicator = null;
  }

  // ── Handle 位置管理 ──

  function updateHandlePosition(view: EditorView, pos: number): void {
    if (!handleDOM) return;
    try {
      const coords = view.coordsAtPos(pos);
      const containerRect = view.dom.parentElement?.getBoundingClientRect();
      if (!containerRect) return;
      handleDOM.style.left = `${coords.left - containerRect.left - 34}px`;
      handleDOM.style.top = `${coords.top - containerRect.top + 1}px`;
      handleDOM.style.opacity = '1';
    } catch {
      handleDOM.style.opacity = '0';
    }
  }

  function hideHandle(): void {
    if (handleDOM && !currentState.menuOpen && !isHandleHovered && !isDragging) {
      hideTimeout = setTimeout(() => {
        if (!isHandleHovered && !currentState.menuOpen && !isDragging && handleDOM) {
          handleDOM.style.opacity = '0';
        }
      }, 200);
    }
  }

  return new Plugin({
    key: blockHandleKey,

    view(editorView) {
      handleDOM = createHandleDOM(editorView);
      return {
        update() {},
        destroy() {
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

          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!pos) { hideHandle(); return false; }

          const $pos = view.state.doc.resolve(pos.pos);
          if ($pos.depth < 1) { hideHandle(); return false; }

          const blockNode = $pos.node(1);
          if (!blockNode) { hideHandle(); return false; }

          const blockDef = blockRegistry.get(blockNode.type.name);
          if (blockDef && blockDef.capabilities.canDrag === false && blockDef.capabilities.canDelete === false) {
            hideHandle();
            return false;
          }

          const blockStart = $pos.before(1);
          if (currentState.pos === blockStart && currentState.visible) return false;

          if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }

          currentState = {
            visible: true,
            pos: blockStart,
            blockType: blockNode.type.name,
            coords: null,
            menuOpen: currentState.menuOpen,
          };

          updateHandlePosition(view, blockStart);
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
