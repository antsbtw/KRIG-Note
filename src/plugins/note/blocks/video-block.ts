import type { BlockDef } from '../types';
import { createRenderBlockView, type RenderBlockRenderer } from './render-block-base';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

const videoRenderer: RenderBlockRenderer = {
  label() { return 'Video'; },
  createContent(node: PMNode, view: EditorView, getPos: () => number | undefined): HTMLElement {
    const content = document.createElement('div');
    content.classList.add('video-block');
    if (node.attrs.src) {
      content.innerHTML = `<video src="${node.attrs.src}" controls style="width:100%"></video>`;
    } else {
      content.innerHTML = '<div class="render-block__placeholder">🎬 输入视频 URL<br><input placeholder="https://youtube.com/..." /></div>';
      setTimeout(() => {
        const input = content.querySelector('input');
        input?.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            const url = (e.target as HTMLInputElement).value.trim();
            if (!url) return;
            const pos = typeof getPos === 'function' ? getPos() : undefined;
            if (pos != null) view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: url }));
          }
        });
      }, 0);
    }
    const captionDOM = document.createElement('div');
    captionDOM.classList.add('render-block__caption');
    content.appendChild(captionDOM);
    (content as any)._captionDOM = captionDOM;
    return content;
  },
  getContentDOM(contentEl: HTMLElement) { return (contentEl as any)._captionDOM; },
};

export const videoBlockBlock: BlockDef = {
  name: 'videoBlock',
  group: 'block',
  nodeSpec: {
    content: 'textBlock',
    group: 'block',
    attrs: { src: { default: null } },
    parseDOM: [{ tag: 'div.video-block' }],
    toDOM() { return ['div', { class: 'video-block' }, 0]; },
  },
  nodeView: createRenderBlockView(videoRenderer, 'video'),
  capabilities: { canDelete: true, canDrag: true },
  slashMenu: { label: 'Video', icon: '🎬', group: 'media', keywords: ['video', '视频'], order: 2 },
};
