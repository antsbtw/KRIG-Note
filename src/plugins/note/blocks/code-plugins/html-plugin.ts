import type { CodeLanguagePlugin, CodePluginContext } from './types';

/**
 * HTML/SVG Code Plugin — iframe 沙箱预览
 *
 * 支持语言：html, svg
 * Preview：将代码渲染到 sandboxed iframe 中
 */

export const htmlPlugin: CodeLanguagePlugin = {
  languages: ['html', 'svg'],
  hasPreview: true,

  renderPreview(code: string, container: HTMLElement) {
    container.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.classList.add('code-plugin-preview__iframe');
    iframe.sandbox.add('allow-scripts');
    iframe.style.cssText = 'width:100%;height:300px;border:none;background:#fff;border-radius:4px;';

    container.appendChild(iframe);

    // 写入 HTML 内容
    const doc = iframe.contentDocument;
    if (doc) {
      doc.open();
      doc.write(code);
      doc.close();

      // 自动调整高度
      iframe.onload = () => {
        try {
          const body = iframe.contentDocument?.body;
          if (body) {
            const height = Math.min(body.scrollHeight + 16, 600);
            iframe.style.height = `${height}px`;
          }
        } catch { /* cross-origin, ignore */ }
      };
    }
  },

  schedulePreview(code: string, container: HTMLElement, ctx: CodePluginContext) {
    // 防抖 500ms — HTML 预览不需要实时
    const key = '__htmlPreviewTimer';
    const existing = (container as any)[key];
    if (existing) clearTimeout(existing);
    (container as any)[key] = setTimeout(() => {
      this.renderPreview?.(code, container, ctx);
    }, 500);
  },

  activate(ctx: CodePluginContext) {
    ctx.previewElement.style.display = 'flex';
    this.renderPreview?.(ctx.getCode(), ctx.previewElement, ctx);
  },

  deactivate(ctx: CodePluginContext) {
    ctx.previewElement.style.display = 'none';
    ctx.previewElement.innerHTML = '';
  },
};
