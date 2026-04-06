/**
 * render-block-focus — 选区在 RenderBlock 内部时保持 toolbar 展开
 *
 * 每次选区变化时：
 * 1. 清除所有 render-block--editing class
 * 2. 检测选区是否在某个 RenderBlock 的 caption 内
 * 3. 给对应的 .render-block DOM 加 render-block--editing
 */

import { Plugin } from 'prosemirror-state';

const RENDER_BLOCK_TYPES = new Set(['image', 'audioBlock', 'videoBlock', 'tweetBlock']);

export function renderBlockFocusPlugin(): Plugin {
  return new Plugin({
    view() {
      return {
        update(view) {
          // 清除旧的 editing class
          const oldEls = view.dom.querySelectorAll('.render-block--editing');
          oldEls.forEach(el => el.classList.remove('render-block--editing'));

          // 检测选区是否在 RenderBlock 内
          const { $from } = view.state.selection;
          for (let d = $from.depth; d >= 1; d--) {
            const ancestor = $from.node(d);
            if (RENDER_BLOCK_TYPES.has(ancestor.type.name)) {
              // 找到对应的 DOM 节点
              const pos = $from.before(d);
              const domNode = view.nodeDOM(pos);
              if (domNode instanceof HTMLElement) {
                // nodeDOM 返回的是 NodeView 的 dom（.render-block wrapper）
                domNode.classList.add('render-block--editing');
              }
              break;
            }
          }
        },
      };
    },
  });
}
