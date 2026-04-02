import type { BlockDef, NodeViewFactory } from '../types';

/**
 * image — 图片 Block
 *
 * 图片由 NodeView 渲染（不在 PM model 中）。
 * contentDOM 包含 paragraph（图片标题/caption）。
 * src 为空时显示上传占位符。
 * 右下角拖拽手柄可缩放图片宽度。
 */

const imageNodeView: NodeViewFactory = (node, view, getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('image-block');

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

      // 保存宽度到 attrs
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos == null) return;
      const newWidth = img.offsetWidth;
      const tr = view.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        width: newWidth,
      });
      view.dispatch(tr);
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

  // 点击占位符触发文件选择
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
        const tr = view.state.tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          src: reader.result as string,
          alt: file.name,
        });
        view.dispatch(tr);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  });

  imgWrapper.appendChild(imgContainer);
  imgWrapper.appendChild(placeholder);

  const contentDOM = document.createElement('div');
  contentDOM.classList.add('image-block__caption');

  dom.appendChild(imgWrapper);
  dom.appendChild(contentDOM);

  return {
    dom,
    contentDOM,
    update(updatedNode) {
      if (updatedNode.type.name !== 'image') return false;
      if (updatedNode.attrs.src) {
        img.src = updatedNode.attrs.src;
        img.alt = updatedNode.attrs.alt || '';
        if (updatedNode.attrs.width) img.style.width = `${updatedNode.attrs.width}px`;
        else img.style.width = '';
        img.style.display = 'block';
        imgContainer.style.display = 'inline-block';
        resizeHandle.style.display = 'block';
        placeholder.style.display = 'none';
      } else {
        img.style.display = 'none';
        imgContainer.style.display = 'none';
        resizeHandle.style.display = 'none';
        placeholder.style.display = 'flex';
      }
      node = updatedNode;
      return true;
    },
    ignoreMutation(mutation) {
      return mutation.target === imgWrapper || imgWrapper.contains(mutation.target as Node);
    },
  };
};

export const imageBlock: BlockDef = {
  name: 'image',
  group: 'block',

  nodeSpec: {
    content: 'paragraph',
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

  nodeView: imageNodeView,

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
