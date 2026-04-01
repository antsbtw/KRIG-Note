import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { blockRegistry } from '../registry';

/**
 * Block Handle Plugin（框架级）
 *
 * 鼠标悬停在 Block 上时，在左侧显示拖拽手柄（⠿）。
 * 点击手柄弹出操作菜单（从 Block 的 capabilities + customActions 派生）。
 *
 * Handle 是 NoteView 框架的 UI，不属于任何 Block。
 */

export const blockHandleKey = new PluginKey('blockHandle');

export interface BlockHandleState {
  /** 手柄是否可见 */
  visible: boolean;
  /** 手柄所在 Block 的文档位置 */
  pos: number;
  /** 手柄所在 Block 的类型名 */
  blockType: string;
  /** 手柄的屏幕坐标 */
  coords: { left: number; top: number } | null;
  /** 菜单是否打开 */
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

  function createHandleDOM(view: EditorView): HTMLDivElement {
    const dom = document.createElement('div');
    dom.className = 'block-handle';
    dom.innerHTML = '⠿';
    dom.style.cssText = `
      position: absolute;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: grab;
      color: #555;
      font-size: 14px;
      border-radius: 4px;
      user-select: none;
      opacity: 0;
      transition: opacity 0.15s;
      z-index: 10;
    `;

    dom.addEventListener('mouseenter', () => {
      dom.style.background = '#333';
      dom.style.color = '#e8eaed';
    });

    dom.addEventListener('mouseleave', () => {
      if (!currentState.menuOpen) {
        dom.style.background = 'transparent';
        dom.style.color = '#555';
      }
    });

    dom.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // 通知 React 组件打开菜单
      currentState = { ...currentState, menuOpen: !currentState.menuOpen };
      // 触发自定义事件让 React 组件知道
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
      const editorRect = view.dom.getBoundingClientRect();
      const containerRect = view.dom.parentElement?.getBoundingClientRect();
      if (!containerRect) return;

      handleDOM.style.left = `${coords.left - containerRect.left - 28}px`;
      handleDOM.style.top = `${coords.top - containerRect.top}px`;
      handleDOM.style.opacity = '1';
    } catch {
      handleDOM.style.opacity = '0';
    }
  }

  function hideHandle(): void {
    if (handleDOM && !currentState.menuOpen) {
      handleDOM.style.opacity = '0';
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
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!pos) {
            hideHandle();
            return false;
          }

          // 找到鼠标所在的顶层 Block
          const $pos = view.state.doc.resolve(pos.pos);
          let blockDepth = 1; // doc 的直接子节点
          if ($pos.depth < 1) {
            hideHandle();
            return false;
          }

          const blockNode = $pos.node(blockDepth);
          if (!blockNode) {
            hideHandle();
            return false;
          }

          const blockDef = blockRegistry.get(blockNode.type.name);

          // noteTitle 等不需要 handle 的 Block
          if (blockDef && blockDef.capabilities.canDrag === false && blockDef.capabilities.canDelete === false) {
            hideHandle();
            return false;
          }

          const blockStart = $pos.before(blockDepth);

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
          // 延迟隐藏，给鼠标移到 handle 上的时间
          setTimeout(() => {
            if (!currentState.menuOpen) {
              hideHandle();
            }
          }, 200);
          return false;
        },
      },
    },
  });
}
