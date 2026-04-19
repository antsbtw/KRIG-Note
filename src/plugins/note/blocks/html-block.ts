import type { BlockDef } from '../types';
import { createRenderBlockView, createPlaceholder, type RenderBlockRenderer, type ToolbarGroup } from './render-block-base';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

/**
 * htmlBlock — HTML 预览（RenderBlock）
 *
 * 用 sandbox iframe 安全地渲染 AI 生成的 HTML artifact。
 * 支持交互式图表（D3/Chart.js）、UI 原型、仪表盘、小工具等。
 *
 * 安全性：
 * - sandbox="allow-scripts"：允许脚本执行，禁止表单提交、弹窗、导航
 * - 不加 allow-same-origin：iframe 内无法访问 Note 页面的 cookie/storage
 * - 使用 srcdoc 注入内容，而非导航到 URL
 */

/** 加载 HTML 文本内容 */
async function loadHtmlContent(src: string): Promise<string | null> {
  try {
    if (src.startsWith('data:text/html;base64,')) {
      const binary = atob(src.split(',')[1]);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    }

    // Try fetch first
    try {
      const response = await fetch(src);
      if (response.ok) {
        const buf = await response.arrayBuffer();
        const text = new TextDecoder('utf-8').decode(buf);
        if (text.length > 0) return text;
      }
    } catch {}

    // Fallback: XMLHttpRequest (for custom protocols like media://)
    return new Promise<string | null>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', src, true);
      xhr.responseType = 'arraybuffer';
      xhr.onload = () => {
        if (xhr.response) {
          const text = new TextDecoder('utf-8').decode(xhr.response);
          resolve(text.length > 0 ? text : null);
        } else {
          resolve(null);
        }
      };
      xhr.onerror = () => resolve(null);
      xhr.send();
    });
  } catch {
    return null;
  }
}

/** 切换源码/预览视图 */
function toggleSourceView(wrapper: HTMLElement, src: string): void {
  const iframe = wrapper.querySelector('.html-block__iframe') as HTMLIFrameElement | null;
  const sourceView = wrapper.querySelector('.html-block__source') as HTMLElement | null;

  if (sourceView) {
    // 已在源码视图 → 切回预览
    sourceView.remove();
    if (iframe) iframe.style.display = 'block';
    return;
  }

  // 切到源码视图
  if (iframe) iframe.style.display = 'none';

  const pre = document.createElement('pre');
  pre.classList.add('html-block__source');

  loadHtmlContent(src).then((html) => {
    if (html) {
      pre.textContent = html;
    }
  });

  const header = wrapper.querySelector('.html-block__header');
  if (header && header.nextSibling) {
    wrapper.insertBefore(pre, header.nextSibling);
  } else {
    wrapper.appendChild(pre);
  }
}

/** 高度调整 handle 设置 */
function setupHeightResize(
  handle: HTMLElement,
  iframe: HTMLIFrameElement,
  onHeightChange: (h: number) => void,
): void {
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const startY = e.clientY;
    const startHeight = iframe.offsetHeight;

    const onMouseMove = (ev: MouseEvent) => {
      const dy = ev.clientY - startY;
      const newHeight = Math.max(100, startHeight + dy);
      iframe.style.height = `${newHeight}px`;
    };

    const onMouseUp = () => {
      onHeightChange(iframe.offsetHeight);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

const htmlBlockRenderer: RenderBlockRenderer = {
  label(node: PMNode) { return node.attrs.title || 'HTML'; },

  createContent(node: PMNode, view: EditorView, getPos: () => number | undefined): HTMLElement {
    const content = document.createElement('div');
    content.classList.add('html-block');

    // 工具函数
    const updateAttrs = (attrs: Record<string, unknown>) => {
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos == null) return;
      let tr = view.state.tr;
      for (const [key, value] of Object.entries(attrs)) {
        tr = tr.setNodeAttribute(pos, key, value);
      }
      view.dispatch(tr);
    };

    if (node.attrs.src) {
      // ── 渲染状态 ──
      const wrapper = document.createElement('div');
      wrapper.classList.add('html-block__wrapper');

      // iframe sandbox
      const iframe = document.createElement('iframe');
      iframe.classList.add('html-block__iframe');
      iframe.setAttribute('sandbox', node.attrs.sandbox || 'allow-scripts');
      iframe.style.width = '100%';
      iframe.style.height = `${node.attrs.height || 400}px`;
      iframe.style.border = 'none';
      iframe.style.borderRadius = '8px';
      iframe.style.backgroundColor = '#ffffff';

      // 加载 HTML 内容，注入高度上报脚本
      loadHtmlContent(node.attrs.src).then((html) => {
        if (html) {
          const heightScript = `<script>
            (function() {
              function reportHeight() {
                var h = Math.max(
                  document.body.scrollHeight,
                  document.body.offsetHeight,
                  document.documentElement.scrollHeight,
                  document.documentElement.offsetHeight
                );
                parent.postMessage({ type: 'krig-iframe-height', height: h }, '*');
              }
              window.addEventListener('load', function() { setTimeout(reportHeight, 100); });
              new MutationObserver(reportHeight).observe(document.body, { childList: true, subtree: true, attributes: true });
              setTimeout(reportHeight, 500);
            })();
          </script>`;
          if (html.includes('</body>')) {
            iframe.srcdoc = html.replace('</body>', heightScript + '</body>');
          } else {
            iframe.srcdoc = html + heightScript;
          }
        }
      });

      // 监听 iframe 高度上报
      const onMessage = (e: MessageEvent) => {
        if (e.data?.type === 'krig-iframe-height' && typeof e.data.height === 'number') {
          if (e.source === iframe.contentWindow) {
            const h = Math.max(200, Math.min(e.data.height + 20, 2000));
            iframe.style.height = `${h}px`;
          }
        }
      };
      window.addEventListener('message', onMessage);
      (content as any)._messageListener = onMessage;

      // 存储 src 供 toolbarButtons 回调使用
      (content as any)._src = node.attrs.src;

      // 高度调整 handle
      const resizeHandle = document.createElement('div');
      resizeHandle.classList.add('html-block__resize-height');
      setupHeightResize(resizeHandle, iframe, (newHeight) => {
        updateAttrs({ height: newHeight });
      });

      wrapper.appendChild(iframe);
      wrapper.appendChild(resizeHandle);
      content.appendChild(wrapper);
    } else {
      // ── Placeholder 状态 ──
      const placeholder = createPlaceholder({
        icon: '🌐',
        uploadLabel: 'Upload HTML',
        uploadAccept: '.html,.htm',
        embedLabel: 'Embed HTML',
        embedPlaceholder: 'Paste HTML code or URL...',
        onUpload: (dataUrl) => updateAttrs({ src: dataUrl }),
        onEmbed: (input) => updateAttrs({ src: input }),
      });
      content.appendChild(placeholder);
    }

    // Caption
    const captionDOM = document.createElement('div');
    captionDOM.classList.add('html-block__caption');
    content.appendChild(captionDOM);
    (content as any)._captionDOM = captionDOM;

    return content;
  },

  update(node: PMNode, contentEl: HTMLElement): boolean {
    const hasWrapper = !!contentEl.querySelector('.html-block__wrapper');
    const hasSrc = !!node.attrs.src;
    if (hasWrapper !== hasSrc) return false;

    if (node.attrs.src) {
      (contentEl as any)._src = node.attrs.src;
      const iframe = contentEl.querySelector('.html-block__iframe') as HTMLIFrameElement;
      if (iframe && node.attrs.height) {
        iframe.style.height = `${node.attrs.height}px`;
      }
    }
    return true;
  },

  toolbarButtons(node: PMNode, contentEl?: HTMLElement): ToolbarGroup[] {
    if (!node.attrs.src) return [];
    const src = (contentEl as any)?._src || node.attrs.src;
    return [{
      id: 'actions',
      buttons: [
        {
          icon: '{ }',
          title: '查看源码',
          onClick: () => {
            const wrapper = contentEl?.querySelector('.html-block__wrapper') as HTMLElement;
            if (wrapper) toggleSourceView(wrapper, src);
          },
        },
        {
          icon: '↗',
          title: '在新窗口中打开',
          onClick: () => {
            loadHtmlContent(src).then((html) => {
              if (html) {
                const blob = new Blob([html], { type: 'text/html' });
                const url = URL.createObjectURL(blob);
                window.open(url, '_blank');
              }
            });
          },
        },
      ],
    }];
  },

  getContentDOM(contentEl: HTMLElement) {
    return (contentEl as any)._captionDOM as HTMLElement;
  },

  destroy(contentEl: HTMLElement) {
    const listener = (contentEl as any)._messageListener;
    if (listener) window.removeEventListener('message', listener);
  },
};

export const htmlBlockBlock: BlockDef = {
  name: 'htmlBlock',
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
      title:       { default: '' },
      height:      { default: 400 },
      sandbox:     { default: 'allow-scripts' },
    },
    parseDOM: [{ tag: 'div.html-block' }],
    toDOM() { return ['div', { class: 'html-block' }, 0]; },
  },
  nodeView: createRenderBlockView(htmlBlockRenderer, 'htmlBlock'),
  capabilities: { canDelete: true, canDrag: true },
  slashMenu: {
    label: 'HTML Preview', icon: '🌐',
    group: 'media', keywords: ['html', 'web', 'preview', '网页'], order: 6,
  },
};
