import type { CodeLanguagePlugin, CodePluginContext } from './types';

/**
 * Markdown Code Plugin — Markdown 渲染预览
 *
 * 支持语言：markdown, md
 * Preview：将 Markdown 渲染为 HTML
 */

export const markdownPlugin: CodeLanguagePlugin = {
  languages: ['markdown', 'md'],
  hasPreview: true,

  renderPreview(code: string, container: HTMLElement) {
    container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.classList.add('code-plugin-preview__markdown');
    wrapper.style.cssText = 'padding:12px 16px;color:#e8eaed;font-size:14px;line-height:1.6;overflow:auto;max-height:500px;';
    wrapper.innerHTML = simpleMarkdownToHtml(code);
    container.appendChild(wrapper);
  },

  schedulePreview(code: string, container: HTMLElement, ctx: CodePluginContext) {
    const key = '__mdPreviewTimer';
    const existing = (container as any)[key];
    if (existing) clearTimeout(existing);
    (container as any)[key] = setTimeout(() => {
      this.renderPreview?.(code, container, ctx);
    }, 300);
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

/** 简易 Markdown → HTML */
function simpleMarkdownToHtml(md: string): string {
  const lines = md.split('\n');
  const html: string[] = [];
  let inList = false;
  let inCodeBlock = false;
  let codeLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // 代码块
    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        html.push(`<pre style="background:#1a1a1a;padding:8px 12px;border-radius:4px;overflow-x:auto;"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        codeLines = [];
        inCodeBlock = false;
      } else {
        if (inList) { html.push('</ul>'); inList = false; }
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) { codeLines.push(line); continue; }

    if (!trimmed) {
      if (inList) { html.push('</ul>'); inList = false; }
      continue;
    }

    // 标题
    const hMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (hMatch) {
      if (inList) { html.push('</ul>'); inList = false; }
      const level = hMatch[1].length;
      html.push(`<h${level} style="color:#fff;margin:0.5em 0 0.3em;">${inlineFormat(hMatch[2])}</h${level}>`);
      continue;
    }

    // 列表
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (!inList) { html.push('<ul style="margin:0.3em 0;padding-left:1.5em;">'); inList = true; }
      html.push(`<li>${inlineFormat(trimmed.slice(2))}</li>`);
      continue;
    }

    if (inList) { html.push('</ul>'); inList = false; }
    html.push(`<p style="margin:0.4em 0;">${inlineFormat(trimmed)}</p>`);
  }

  if (inList) html.push('</ul>');
  if (inCodeBlock) html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  return html.join('\n');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineFormat(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong style="color:#fff;">$1</strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  s = s.replace(/`(.+?)`/g, '<code style="background:rgba(138,180,248,0.1);padding:1px 4px;border-radius:3px;font-size:0.9em;">$1</code>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#8ab4f8;">$1</a>');
  return s;
}
