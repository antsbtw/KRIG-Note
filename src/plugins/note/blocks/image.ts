import type { BlockDef } from '../types';
import { createRenderBlockView, type RenderBlockRenderer } from './render-block-base';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

/**
 * image — 图片 Block（RenderBlock）
 *
 * NodeView 渲染图片 + 缩放手柄。
 * contentDOM 包含 textBlock（caption）。
 */

const imageRenderer: RenderBlockRenderer = {
  label() { return 'Image'; },

  createContent(node: PMNode, view: EditorView, getPos: () => number | undefined): HTMLElement {
    const content = document.createElement('div');
    content.classList.add('image-block');

    const imgWrapper = document.createElement('div');
    imgWrapper.classList.add('image-block__wrapper');

    const imgContainer = document.createElement('div');
    imgContainer.classList.add('image-block__container');
    imgContainer.style.position = 'relative';
    imgContainer.style.display = 'inline-block';

    const img = document.createElement('img');
    img.classList.add('image-block__img');
    if (node.attrs.src) {
      img.src = node.attrs.src;
      img.alt = node.attrs.alt || '';
      if (node.attrs.width) img.style.width = `${node.attrs.width}px`;
    }
    img.style.display = node.attrs.src ? 'block' : 'none';

    // 缩放手柄
    const resizeHandle = document.createElement('div');
    resizeHandle.classList.add('image-block__resize');
    resizeHandle.style.display = node.attrs.src ? 'block' : 'none';

    let resizing = false;
    let startX = 0;
    let startWidth = 0;
    let currentNode = node;

    resizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      resizing = true;
      startX = e.clientX;
      startWidth = img.offsetWidth;
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';

      const onMouseMove = (me: MouseEvent) => {
        if (!resizing) return;
        const newWidth = Math.max(100, startWidth + (me.clientX - startX));
        img.style.width = `${newWidth}px`;
      };

      const onMouseUp = () => {
        if (!resizing) return;
        resizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (pos == null) return;
        const newWidth = img.offsetWidth;
        view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, {
          ...currentNode.attrs,
          width: newWidth,
        }));
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    imgContainer.appendChild(img);
    imgContainer.appendChild(resizeHandle);

    const placeholder = document.createElement('div');
    placeholder.classList.add('image-block__placeholder');
    placeholder.textContent = '🖼 点击添加图片';
    placeholder.style.display = node.attrs.src ? 'none' : 'flex';

    placeholder.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const pos = typeof getPos === 'function' ? getPos() : undefined;
          if (pos == null) return;
          view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, {
            ...currentNode.attrs,
            src: reader.result as string,
            alt: file.name,
          }));
        };
        reader.readAsDataURL(file);
      };
      input.click();
    });

    imgWrapper.appendChild(imgContainer);
    imgWrapper.appendChild(placeholder);

    const captionDOM = document.createElement('div');
    captionDOM.classList.add('image-block__caption');

    content.appendChild(imgWrapper);
    content.appendChild(captionDOM);

    // 存储引用
    (content as any)._refs = { img, imgContainer, resizeHandle, placeholder, setNode: (n: PMNode) => { currentNode = n; } };
    (content as any)._captionDOM = captionDOM;

    return content;
  },

  update(node: PMNode, contentEl: HTMLElement): boolean {
    const refs = (contentEl as any)._refs;
    if (!refs) return true;
    refs.setNode(node);

    if (node.attrs.src) {
      refs.img.src = node.attrs.src;
      refs.img.alt = node.attrs.alt || '';
      if (node.attrs.width) refs.img.style.width = `${node.attrs.width}px`;
      else refs.img.style.width = '';
      refs.img.style.display = 'block';
      refs.imgContainer.style.display = 'inline-block';
      refs.resizeHandle.style.display = 'block';
      refs.placeholder.style.display = 'none';
    } else {
      refs.img.style.display = 'none';
      refs.imgContainer.style.display = 'none';
      refs.resizeHandle.style.display = 'none';
      refs.placeholder.style.display = 'flex';
    }
    return true;
  },

  getContentDOM(contentEl: HTMLElement) {
    return (contentEl as any)._captionDOM as HTMLElement;
  },

  createFullscreenContent(node: PMNode): HTMLElement | null {
    if (!node.attrs.src) return null;
    const img = document.createElement('img');
    img.src = node.attrs.src;
    img.alt = node.attrs.alt || '';
    img.style.maxWidth = '100%';
    img.style.maxHeight = '100%';
    img.style.objectFit = 'contain';
    return img;
  },
};

export const imageBlock: BlockDef = {
  name: 'image',
  group: 'block',

  nodeSpec: {
    content: 'textBlock',
    group: 'block',
    attrs: {
      src: { default: null },
      alt: { default: '' },
      width: { default: null },
      height: { default: null },
    },
    parseDOM: [{ tag: 'div.image-block' }],
    toDOM() { return ['div', { class: 'image-block' }, 0]; },
  },

  nodeView: createRenderBlockView(imageRenderer, 'image'),

  capabilities: {
    turnInto: [],
    canDelete: true,
    canDrag: true,
  },

  slashMenu: {
    label: 'Image',
    icon: '🖼',
    group: 'media',
    keywords: ['image', 'picture', 'photo', 'img'],
    order: 0,
  },
};
