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

          // ══════════════════════════════════════════════════
          // 手柄定位逻辑（已稳定，不要修改）
          //
          // 原则：只看 Y 坐标，鼠标在哪一行就显示哪行的手柄
          // 方案：posAtCoords（X 固定）+ DOM rect 回退
          // X 范围：编辑器区域内（含左侧手柄空间）
          // Y 容差：margin 间隙 20px 内也命中
          // ══════════════════════════════════════════════════

          // X 范围限制：只在编辑器视图内触发
          const editorRect = view.dom.getBoundingClientRect();
          if (event.clientX < editorRect.left - 70 || event.clientX > editorRect.right + 10) {
            hideHandle(); return false;
          }

          // 按 Y 坐标查找 block — 用 posAtCoords，X 固定在内容区
          const mouseY = event.clientY;
          const probeX = editorRect.left + editorRect.width / 2;
          let blockStart = -1;
          let blockNode: any = null;
          let targetBlockDOM: HTMLElement | null = null;

          // 主方案：posAtCoords
          const pos = view.posAtCoords({ left: probeX, top: mouseY });
          if (pos) {
            try {
              const $pos = view.state.doc.resolve(pos.pos);
              let depth = $pos.depth;
              while (depth > 0 && ($pos.node(depth).isInline || $pos.node(depth).type.name === 'text')) depth--;
              if (depth >= 1) {
                blockStart = $pos.before(depth);
                blockNode = $pos.node(depth);
                const dom = view.nodeDOM(blockStart);
                targetBlockDOM = dom instanceof HTMLElement ? dom : (dom as Node)?.parentElement as HTMLElement ?? null;
              }
            } catch { /* ignore */ }
          }

          // 回退：posAtCoords 在 margin 间隙失败时，遍历顶层子 DOM 找 Y 最近的
          if (blockStart < 0) {
            const children = view.dom.children;
            let minDist = Infinity;
            for (let i = 0; i < children.length; i++) {
              const child = children[i] as HTMLElement;
              const rect = child.getBoundingClientRect();
              // 鼠标在 block rect 范围内
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
              // 最近的 block（margin 间隙）
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

          // noteTitle 不显示手柄
          if (blockNode.type.name === 'textBlock' && blockNode.attrs.isTitle) { hideHandle(); return false; }

          if (currentPos === blockStart) return false;
          currentPos = blockStart;
          currentBlockType = blockNode.type.name;

          if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }

          // 定位手柄
          if (handleDOM) {
            const container = handleDOM.parentElement;
            const containerRect = container?.getBoundingClientRect();
            if (containerRect && container) {
              const blockRect = targetBlockDOM.getBoundingClientRect();
              const scrollTop = container.scrollTop;
              const handleHeight = 24;

              // 获取第一行文字位置用于垂直居中
              let textTop = blockRect.top;
              let lineHeight = 27;
              try {
                const coords = view.coordsAtPos(blockStart + 1);
                if (coords.top >= blockRect.top && coords.top <= blockRect.bottom) {
                  textTop = coords.top;
                  lineHeight = coords.bottom - coords.top;
                }
              } catch { /* fallback */ }

              const topPx = textTop - containerRect.top + scrollTop + (lineHeight - handleHeight) / 2;
              handleDOM.style.left = `${blockRect.left - containerRect.left + container.scrollLeft - 62}px`;
              handleDOM.style.top = `${topPx}px`;
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
