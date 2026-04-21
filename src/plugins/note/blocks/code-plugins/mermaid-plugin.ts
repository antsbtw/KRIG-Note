import type { CodeLanguagePlugin, CodePluginContext, ToolbarButtonDef } from './types';

/**
 * Mermaid Code Plugin — 图表渲染、全屏编辑、下载 PNG/SVG
 *
 * 当前为过渡版本：核心渲染逻辑仍在 code-block.ts 中，
 * 此插件通过接口声明能力，code-block.ts 根据 hasPreview 等标志决定行为。
 * 后续逐步将渲染/全屏/下载逻辑迁移到此文件。
 */

export const mermaidPlugin: CodeLanguagePlugin = {
  languages: ['mermaid'],
  hasPreview: true,

  // 工具栏按钮由 code-block.ts 内部管理（过渡期）
  // 后续迁移到这里

  activate(ctx: CodePluginContext) {
    // Mermaid 激活时显示预览区
    ctx.previewElement.style.display = 'flex';
  },

  deactivate(ctx: CodePluginContext) {
    // Mermaid 停用时隐藏预览区
    ctx.previewElement.style.display = 'none';
  },
};
