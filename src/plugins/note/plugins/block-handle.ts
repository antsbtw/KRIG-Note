import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

/**
 * Block Handle Plugin — 鼠标悬停 Block 时显示手柄（+ ⠿）
 *
 * 单击 ⠿ → 弹出 HandleMenu（通过 CustomEvent）
 * + → 在下方插入新 paragraph
 */

export const blockHandleKey = new PluginKey('blockHandle');

export function blockHandlePlugin(): Plugin {
  let handleDOM: HTMLDivElement | null = null;
  let currentPos = -1;
  let currentBlockType = '';
  let isHovered = false;
  let hideTimeout: ReturnType<typeof setTimeout> | null = null;

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
        const { TextSelection } = require('prosemirror-state');
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
    dragBtn.style.cssText = `
      width: 24px; height: 24px;
      display: flex; align-items: center; justify-content: center;
      cursor: grab; color: #555; font-size: 18px; border-radius: 3px;
    `;
    dragBtn.addEventListener('mouseenter', () => { dragBtn.style.background = '#333'; dragBtn.style.color = '#e8eaed'; });
    dragBtn.addEventListener('mouseleave', () => { dragBtn.style.background = 'transparent'; dragBtn.style.color = '#555'; });
    dragBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // 单击 → 弹出菜单
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
        destroy() { handleDOM?.remove(); handleDOM = null; },
      };
    },

    props: {
      handleDOMEvents: {
        mousemove(view, event) {
          if (isHovered) return false;

          // DOM 遍历找到 doc 的直接子节点
          let target = event.target as HTMLElement | null;
          const pmDOM = view.dom;
          let blockDOM: HTMLElement | null = null;
          while (target && target !== pmDOM) {
            if (target.parentElement === pmDOM) { blockDOM = target; break; }
            target = target.parentElement;
          }
          if (!blockDOM) { hideHandle(); return false; }

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

          // noteTitle 不显示手柄
          if (topNode.type.name === 'textBlock' && topNode.attrs.isTitle) { hideHandle(); return false; }

          if (currentPos === blockStart) return false;
          currentPos = blockStart;
          currentBlockType = topNode.type.name;

          if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }

          // 定位手柄
          if (handleDOM) {
            const container = handleDOM.parentElement;
            const containerRect = container?.getBoundingClientRect();
            if (containerRect && container) {
              const blockRect = blockDOM.getBoundingClientRect();
              const scrollTop = container.scrollTop;
              handleDOM.style.left = `${blockRect.left - containerRect.left + container.scrollLeft - 62}px`;
              handleDOM.style.top = `${blockRect.top - containerRect.top + scrollTop + 2}px`;
              handleDOM.style.opacity = '1';
            }
          }

          return false;
        },
        mouseleave() { hideHandle(); return false; },
      },
    },
  });
}
