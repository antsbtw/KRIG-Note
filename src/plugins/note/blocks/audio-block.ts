import type { BlockDef } from '../types';
import { createRenderBlockView, type RenderBlockRenderer } from './render-block-base';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

const audioRenderer: RenderBlockRenderer = {
  label() { return 'Audio'; },
  createContent(node: PMNode, view: EditorView, getPos: () => number | undefined): HTMLElement {
    const content = document.createElement('div');
    content.classList.add('audio-block');
    if (node.attrs.src) {
      content.innerHTML = `<audio src="${node.attrs.src}" controls style="width:100%"></audio>`;
    } else {
      content.innerHTML = '<div class="render-block__placeholder">🎵 点击上传音频</div>';
      content.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'audio/*';
        input.addEventListener('change', () => {
          const file = input.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const pos = typeof getPos === 'function' ? getPos() : undefined;
            if (pos != null) view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: reader.result as string }));
          };
          reader.readAsDataURL(file);
        });
        input.click();
      });
    }
    const captionDOM = document.createElement('div');
    captionDOM.classList.add('render-block__caption');
    content.appendChild(captionDOM);
    (content as any)._captionDOM = captionDOM;
    return content;
  },
  getContentDOM(contentEl: HTMLElement) { return (contentEl as any)._captionDOM; },
};

export const audioBlockBlock: BlockDef = {
  name: 'audioBlock',
  group: 'block',
  nodeSpec: {
    content: 'textBlock',
    group: 'block',
    attrs: { src: { default: null } },
    parseDOM: [{ tag: 'div.audio-block' }],
    toDOM() { return ['div', { class: 'audio-block' }, 0]; },
  },
  nodeView: createRenderBlockView(audioRenderer, 'audio'),
  capabilities: { canDelete: true, canDrag: true },
  slashMenu: { label: 'Audio', icon: '🎵', group: 'media', keywords: ['audio', '音频'], order: 3 },
};
