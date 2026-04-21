import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

/**
 * CodeLanguagePlugin — codeBlock 语言插件接口
 *
 * 每种语言（或一组语言）实现此接口，提供：
 * - Preview 渲染
 * - 额外的工具栏按钮（下载、全屏等）
 * - 全屏编辑器扩展
 *
 * 核心 codeBlock 不知道任何语言的具体实现，
 * 只通过此接口查询当前语言的能力。
 */

export interface CodeLanguagePlugin {
  /** 匹配哪些语言标识（如 ['mermaid'] 或 ['html', 'svg']） */
  languages: string[];

  /** 是否支持 Preview */
  hasPreview: boolean;

  /** 额外的工具栏按钮（渲染在 Copy 按钮左侧） */
  toolbarButtons?: (ctx: CodePluginContext) => ToolbarButtonDef[];

  /** 渲染预览内容到 preview 容器 */
  renderPreview?: (code: string, container: HTMLElement, ctx: CodePluginContext) => void;

  /** 调度预览渲染（防抖等）— 如不提供，则在每次内容变化时直接调用 renderPreview */
  schedulePreview?: (code: string, container: HTMLElement, ctx: CodePluginContext) => void;

  /** 打开全屏编辑器 */
  openFullscreen?: (ctx: CodePluginContext) => void;

  /** 插件激活时调用（语言切换到此插件时） */
  activate?: (ctx: CodePluginContext) => void;

  /** 插件停用时调用（语言切换离开此插件时） */
  deactivate?: (ctx: CodePluginContext) => void;

  /** 销毁时清理 */
  destroy?: () => void;
}

/** 插件可访问的 codeBlock 上下文 */
export interface CodePluginContext {
  /** 当前 PM node */
  node: PMNode;
  /** ProseMirror EditorView */
  view: EditorView;
  /** 获取当前节点在 doc 中的位置 */
  getPos: () => number | undefined;
  /** 代码区 DOM 元素 */
  codeElement: HTMLElement;
  /** 预览区 DOM 元素 */
  previewElement: HTMLElement;
  /** 整个 codeBlock 的 DOM 容器 */
  dom: HTMLElement;
  /** 获取当前代码文本 */
  getCode: () => string;
  /** 更新 PM node 属性 */
  updateAttrs: (attrs: Record<string, unknown>) => void;
}

/** 工具栏按钮定义 */
export interface ToolbarButtonDef {
  icon: string;         // SVG 或文字
  title: string;        // tooltip
  onClick: () => void;
  isActive?: () => boolean;
  className?: string;
}
