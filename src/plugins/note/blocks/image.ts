import type { BlockDef } from '../types';
import { createRenderBlockView, createPlaceholder, type RenderBlockRenderer, type ToolbarGroup } from './render-block-base';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

/**
 * image — 图片（RenderBlock）
 *
 * 三种状态：placeholder → AI 描述占位 → 图片显示
 * 功能：Upload / Embed link、alignment 工具栏、左右 resize handles
 *
 * SVG 增强：检测 src 为 SVG 时，使用 <div> + innerHTML 直接渲染 SVG DOM，
 * 替代 <img> 标签，解决 CSS 变量失效、事件处理器无效、字体 fallback 等问题。
 */

const ALIGNMENTS = ['left', 'center', 'right'] as const;
const ALIGN_ICONS: Record<string, string> = { left: '◁', center: '▣', right: '▷' };

/** 判断 src 是否为 SVG */
function isSvgSrc(src: string | null): boolean {
  if (!src) return false;
  return src.endsWith('.svg') || src.startsWith('data:image/svg+xml');
}

/** 加载 SVG 文本内容 */
async function loadSvgContent(src: string): Promise<string | null> {
  try {
    if (src.startsWith('data:image/svg+xml;base64,')) {
      return atob(src.split(',')[1]);
    }
    const response = await fetch(src);
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

/** SVG DOM 插入后注入样式 */
function injectSvgStyles(container: HTMLElement): void {
  const svg = container.querySelector('svg');
  if (!svg) return;

  // 确保 SVG 自适应容器宽度
  svg.style.width = '100%';
  svg.style.height = 'auto';
  svg.style.display = 'block';

  // 白色背景（暗色主题下可见）
  svg.style.backgroundColor = '#ffffff';
  svg.style.borderRadius = '8px';

  // 如果 SVG 没有内嵌 <style>，注入默认字体样式
  if (!svg.querySelector('style')) {
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = `
      text { font-family: system-ui, -apple-system, sans-serif; }
      .ts { font-size: 13px; fill: #525252; }
      .th { font-size: 15px; fill: #171717; font-weight: 600; }
    `;
    svg.insertBefore(style, svg.firstChild);
  }
}

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
      imgWrapper.dataset.alignment = currentAlignment;
      const imgArea = document.createElement('div');
      imgArea.classList.add('image-block__img-area');

      const isSvg = isSvgSrc(node.attrs.src);

      // ── Resize handles ──
      const handleLeft = document.createElement('div');
      handleLeft.classList.add('image-block__resize-handle', 'image-block__resize-handle--left');
      const handleRight = document.createElement('div');
      handleRight.classList.add('image-block__resize-handle', 'image-block__resize-handle--right');

      if (isSvg) {
        // ── SVG 渲染路径 ──
        const svgCanvas = document.createElement('div');
        svgCanvas.classList.add('image-block__svg-canvas');
        if (node.attrs.width) svgCanvas.style.width = `${node.attrs.width}px`;

        // 异步加载 SVG 内容
        loadSvgContent(node.attrs.src).then((svgText) => {
          if (svgText) {
            svgCanvas.innerHTML = svgText;
            injectSvgStyles(svgCanvas);

            // 尺寸自动检测
            const svg = svgCanvas.querySelector('svg');
            if (svg && !node.attrs.width && !node.attrs.height) {
              const vb = svg.getAttribute('viewBox');
              if (vb) {
                const parts = vb.split(/[\s,]+/).map(Number);
                if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
                  updateAttrs({ width: Math.round(parts[2]), height: Math.round(parts[3]) });
                }
              }
            }
          }
        });

        const setupResize = (handle: HTMLElement, direction: 'left' | 'right') => {
          handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            imgWrapper.classList.add('image-block--resizing');

            const startX = e.clientX;
            const startWidth = svgCanvas.offsetWidth;
            const svg = svgCanvas.querySelector('svg');
            const vb = svg?.getAttribute('viewBox');
            const vbParts = vb ? vb.split(/[\s,]+/).map(Number) : null;
            const ratio = (vbParts && vbParts.length === 4 && vbParts[2] > 0)
              ? vbParts[3] / vbParts[2] : 1;

            const onMouseMove = (ev: MouseEvent) => {
              const dx = direction === 'right' ? ev.clientX - startX : startX - ev.clientX;
              const newWidth = Math.max(100, startWidth + dx);
              svgCanvas.style.width = `${newWidth}px`;
            };

            const onMouseUp = () => {
              imgWrapper.classList.remove('image-block--resizing');
              const finalWidth = svgCanvas.offsetWidth;
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
        imgArea.appendChild(svgCanvas);
        imgArea.appendChild(handleRight);
      } else {
        // ── 原有 <img> 渲染路径 ──
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
      }

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

    // 检测 SVG ↔ 非 SVG 切换 → 重建 NodeView
    const hasSvgCanvas = !!wrapper.querySelector('.image-block__svg-canvas');
    const isSvg = isSvgSrc(node.attrs.src);
    if (hasSvgCanvas !== isSvg) return false;

    // 更新 alignment（设在 wrapper 上，CSS 通过 text-align 控制）
    (wrapper as HTMLElement).dataset.alignment = (node.attrs.alignment as string) || 'center';

    // 更新内容
    if (node.attrs.src) {
      if (isSvg) {
        // SVG 路径：如果 src 变了，重新 fetch + innerHTML
        const canvas = wrapper.querySelector('.image-block__svg-canvas') as HTMLElement;
        if (canvas) {
          const currentSrc = (canvas as any).__svgSrc;
          if (currentSrc !== node.attrs.src) {
            (canvas as any).__svgSrc = node.attrs.src;
            loadSvgContent(node.attrs.src).then((svgText) => {
              if (svgText) {
                canvas.innerHTML = svgText;
                injectSvgStyles(canvas);
              }
            });
          }
          if (node.attrs.width) canvas.style.width = `${node.attrs.width}px`;
        }
      } else {
        // 原有 <img> 更新逻辑
        const img = wrapper.querySelector('img');
        if (img) {
          if (img.src !== node.attrs.src) img.src = node.attrs.src;
          img.alt = node.attrs.alt || '';
          if (node.attrs.width) img.style.width = `${node.attrs.width}px`;
        }
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
