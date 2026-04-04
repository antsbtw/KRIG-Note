import type { BlockDef } from '../types';
import { createRenderBlockView, type RenderBlockRenderer } from './render-block-base';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

/**
 * image — 图片（RenderBlock）
 *
 * 点击上传图片，caption 由 contentDOM 管理。
 */

const imageRenderer: RenderBlockRenderer = {
  label() { return 'Image'; },

  createContent(node: PMNode, view: EditorView, getPos: () => number | undefined): HTMLElement {
    const content = document.createElement('div');
    content.classList.add('image-block');

    const imgWrapper = document.createElement('div');
    imgWrapper.classList.add('image-block__wrapper');

    if (node.attrs.src) {
      const img = document.createElement('img');
      img.src = node.attrs.src;
      img.alt = node.attrs.alt || '';
      img.style.maxWidth = '100%';
      imgWrapper.appendChild(img);
    } else {
      imgWrapper.innerHTML = '<div class="image-block__placeholder">🖼 点击添加图片</div>';
      imgWrapper.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.addEventListener('change', () => {
          const file = input.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const pos = typeof getPos === 'function' ? getPos() : undefined;
            if (pos != null) {
              view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: reader.result as string }));
            }
          };
          reader.readAsDataURL(file);
        });
        input.click();
      });
    }

    const captionDOM = document.createElement('div');
    captionDOM.classList.add('image-block__caption');

    content.appendChild(imgWrapper);
    content.appendChild(captionDOM);

    (content as any)._captionDOM = captionDOM;
    return content;
  },

  update(node: PMNode, contentEl: HTMLElement): boolean {
    const wrapper = contentEl.querySelector('.image-block__wrapper');
    if (!wrapper) return true;

    if (node.attrs.src) {
      let img = wrapper.querySelector('img');
      if (!img) {
        wrapper.innerHTML = '';
        img = document.createElement('img');
        img.style.maxWidth = '100%';
        wrapper.appendChild(img);
      }
      img.src = node.attrs.src;
      img.alt = node.attrs.alt || '';
    }
    return true;
  },

  getContentDOM(contentEl: HTMLElement) {
    return (contentEl as any)._captionDOM as HTMLElement;
  },
};

export const imageBlock: BlockDef = {
  name: 'image',
  group: 'block',
  nodeSpec: {
    content: 'textBlock',
    group: 'block',
    attrs: { src: { default: null }, alt: { default: '' }, width: { default: null } },
    parseDOM: [{ tag: 'div.image-block' }],
    toDOM() { return ['div', { class: 'image-block' }, 0]; },
  },
  nodeView: createRenderBlockView(imageRenderer, 'image'),
  capabilities: { canDelete: true, canDrag: true },
  slashMenu: { label: 'Image', icon: '🖼', group: 'media', keywords: ['image', 'picture', 'photo', '图片'], order: 1 },
};
