import type { BlockDef } from '../types';
import { createRenderBlockView, createPlaceholder, type RenderBlockRenderer, type ToolbarGroup } from './render-block-base';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

/**
 * image — 图片（RenderBlock）
 *
 * 三种状态：placeholder → AI 描述占位 → 图片显示
 * 功能：Upload / Embed link、alignment 工具栏、左右 resize handles
 */

const ALIGNMENTS = ['left', 'center', 'right'] as const;
const ALIGN_ICONS: Record<string, string> = { left: '◁', center: '▣', right: '▷' };

const imageRenderer: RenderBlockRenderer = {
  label() { return 'Image'; },

  createContent(node: PMNode, view: EditorView, getPos: () => number | undefined): HTMLElement {
    const content = document.createElement('div');
    content.classList.add('image-block');

    const imgWrapper = document.createElement('div');
    imgWrapper.classList.add('image-block__wrapper');

    // ── 状态变量 ──
    let currentAlignment = (node.attrs.alignment as string) || 'center';
    // isResizing tracked via CSS class on imgWrapper

    // 工具函数：逐个设置 node attr（避免 setNodeMarkup 重验证 content）
    const updateAttrs = (attrs: Record<string, unknown>) => {
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos == null) return;
      let tr = view.state.tr;
      for (const [key, value] of Object.entries(attrs)) {
        tr = tr.setNodeAttribute(pos, key, value);
      }
      view.dispatch(tr);
    };

    // 存储对齐回调供 toolbarButtons 使用
    (content as any)._setAlignment = (align: string) => {
      currentAlignment = align;
      updateAttrs({ alignment: align });
    };

    if (node.attrs.src) {
      // ── 图片显示状态 ──

      // 图片区域
      imgWrapper.dataset.alignment = currentAlignment;
      const imgArea = document.createElement('div');
      imgArea.classList.add('image-block__img-area');

      const img = document.createElement('img');
      img.src = node.attrs.src;
      img.alt = node.attrs.alt || '';
      if (node.attrs.width) img.style.width = `${node.attrs.width}px`;
      img.draggable = false;

      // 尺寸自动检测
      img.addEventListener('load', () => {
        if (!node.attrs.width && !node.attrs.height) {
          updateAttrs({ width: img.naturalWidth, height: img.naturalHeight });
        }
      });

      // ── Resize handles ──
      const handleLeft = document.createElement('div');
      handleLeft.classList.add('image-block__resize-handle', 'image-block__resize-handle--left');
      const handleRight = document.createElement('div');
      handleRight.classList.add('image-block__resize-handle', 'image-block__resize-handle--right');

      const setupResize = (handle: HTMLElement, direction: 'left' | 'right') => {
        handle.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          imgWrapper.classList.add('image-block--resizing');

          const startX = e.clientX;
          const startWidth = img.offsetWidth;
          const ratio = img.naturalHeight / img.naturalWidth || 1;

          const onMouseMove = (ev: MouseEvent) => {
            const dx = direction === 'right' ? ev.clientX - startX : startX - ev.clientX;
            const newWidth = Math.max(100, startWidth + dx);
            img.style.width = `${newWidth}px`;
          };

          const onMouseUp = () => {
            imgWrapper.classList.remove('image-block--resizing');
            const finalWidth = img.offsetWidth;
            updateAttrs({ width: finalWidth, height: Math.round(finalWidth * ratio) });
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
          };

          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
        });
      };

      setupResize(handleLeft, 'left');
      setupResize(handleRight, 'right');

      imgArea.appendChild(handleLeft);
      imgArea.appendChild(img);
      imgArea.appendChild(handleRight);
      imgWrapper.appendChild(imgArea);
    } else {
      // ── Placeholder 状态（Upload + Embed link） ──
      const placeholder = createPlaceholder({
        icon: '🖼',
        uploadLabel: 'Upload',
        uploadAccept: 'image/*',
        embedLabel: 'Embed link',
        embedPlaceholder: 'Paste image URL...',
        onUpload: (dataUrl) => updateAttrs({ src: dataUrl }),
        onEmbed: (url) => updateAttrs({ src: url }),
      });
      imgWrapper.appendChild(placeholder);
    }

    // ── Caption ──
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

    // 检测状态切换（placeholder ↔ 图片显示）→ 需要重建 NodeView
    const hasImg = wrapper.querySelector('.image-block__img-area') !== null;
    const hasSrc = !!node.attrs.src;
    if (hasImg !== hasSrc) return false; // 返回 false → ProseMirror 重建 NodeView

    // 更新 alignment（设在 wrapper 上，CSS 通过 text-align 控制）
    (wrapper as HTMLElement).dataset.alignment = (node.attrs.alignment as string) || 'center';

    // 更新 img src/width
    if (node.attrs.src) {
      const img = wrapper.querySelector('img');
      if (img) {
        if (img.src !== node.attrs.src) img.src = node.attrs.src;
        img.alt = node.attrs.alt || '';
        if (node.attrs.width) img.style.width = `${node.attrs.width}px`;
      }
    }
    return true;
  },

  toolbarButtons(node: PMNode, contentEl?: HTMLElement): ToolbarGroup[] {
    const current = (node.attrs.alignment as string) || 'center';
    const setAlign = (contentEl as any)?._setAlignment as ((a: string) => void) | undefined;
    return [{
      id: 'align',
      buttons: ALIGNMENTS.map(align => ({
        icon: ALIGN_ICONS[align],
        title: `Align ${align}`,
        isActive: () => align === current,
        onClick: () => setAlign?.(align),
      })),
    }];
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
    draggable: true,
    selectable: true,
    attrs: {
      atomId:      { default: null },
      sourcePages: { default: null },
      thoughtId:   { default: null },
      src:         { default: null },
      alt:         { default: '' },
      title:       { default: '' },
      width:       { default: null },
      height:      { default: null },
      alignment:   { default: 'center' },
    },
    parseDOM: [{ tag: 'div.image-block' }],
    toDOM() { return ['div', { class: 'image-block' }, 0]; },
  },
  nodeView: createRenderBlockView(imageRenderer, 'image'),
  capabilities: { canDelete: true, canDrag: true },
  slashMenu: { label: 'Image', icon: '🖼', group: 'media', keywords: ['image', 'picture', 'photo', '图片'], order: 1 },
};
