import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { blockRegistry } from '../registry';

/**
 * Block Handle Plugin（框架级）
 *
 * 鼠标悬停 Block 时，在左侧显示拖拽手柄（⠿）。
 * 点击手柄弹出操作菜单。
 * 手柄区域加大，hover 保持显示。
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

export function blockHandlePlugin(): Plugin {
  let handleDOM: HTMLDivElement | null = null;
  let currentState = INITIAL_STATE;
  let isHandleHovered = false;
  let hideTimeout: ReturnType<typeof setTimeout> | null = null;

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
      if (!currentState.menuOpen) {
        dom.style.background = 'transparent';
        dom.style.color = '#555';
        // 延迟隐藏
        hideTimeout = setTimeout(() => {
          if (!isHandleHovered && !currentState.menuOpen) {
            dom.style.opacity = '0';
          }
        }, 300);
      }
    });

    dom.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      currentState = { ...currentState, menuOpen: !currentState.menuOpen };
      const event = new CustomEvent('block-handle-click', {
        detail: {
          pos: currentState.pos,
          blockType: currentState.blockType,
          coords: { left: dom.getBoundingClientRect().left, top: dom.getBoundingClientRect().bottom },
        },
      });
      view.dom.dispatchEvent(event);
    });

    view.dom.parentElement?.appendChild(dom);
    return dom;
  }

  function updateHandlePosition(view: EditorView, pos: number): void {
    if (!handleDOM) return;

    try {
      const coords = view.coordsAtPos(pos);
      const containerRect = view.dom.parentElement?.getBoundingClientRect();
      if (!containerRect) return;

      handleDOM.style.left = `${coords.left - containerRect.left - 32}px`;
      handleDOM.style.top = `${coords.top - containerRect.top - 2}px`;
      handleDOM.style.opacity = '1';
    } catch {
      handleDOM.style.opacity = '0';
    }
  }

  function hideHandle(): void {
    if (handleDOM && !currentState.menuOpen && !isHandleHovered) {
      hideTimeout = setTimeout(() => {
        if (!isHandleHovered && !currentState.menuOpen && handleDOM) {
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
        },
      };
    },

    props: {
      handleDOMEvents: {
        mousemove(view, event) {
          // 如果鼠标在 Handle 上，不更新位置
          if (isHandleHovered) return false;

          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!pos) {
            hideHandle();
            return false;
          }

          const $pos = view.state.doc.resolve(pos.pos);
          if ($pos.depth < 1) {
            hideHandle();
            return false;
          }

          const blockNode = $pos.node(1);
          if (!blockNode) {
            hideHandle();
            return false;
          }

          const blockDef = blockRegistry.get(blockNode.type.name);
          if (blockDef && blockDef.capabilities.canDrag === false && blockDef.capabilities.canDelete === false) {
            hideHandle();
            return false;
          }

          const blockStart = $pos.before(1);

          // 如果是同一个 Block，不重复更新
          if (currentState.pos === blockStart && currentState.visible) {
            return false;
          }

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

        mouseleave(_view, _event) {
          hideHandle();
          return false;
        },
      },
    },
  });
}
