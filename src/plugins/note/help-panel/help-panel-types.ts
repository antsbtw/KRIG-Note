/**
 * help-panel-types — Help Panel 框架共享类型定义
 *
 * 所有 Help Panel（LaTeX、Mermaid、Dictionary …）共享这些类型，
 * 确保统一的 Shell 结构和互斥契约。
 */

/** 传给 createHelpPanel 的配置 */
export interface HelpPanelConfig {
  /** 面板唯一标识，如 "latex", "mermaid", "dictionary" */
  id: string;
  /** 标题栏显示文字 */
  title: string;
  /**
   * 点击这些 CSS 选择器匹配的元素时，不触发"点击外部关闭"。
   * 面板自身始终被排除。
   * 示例: ['.math-block-wrapper', '.math-inline-editor']
   */
  excludeFromClickOutside?: string[];
}

/** createHelpPanel 返回的 DOM Shell */
export interface HelpPanelShell {
  /** 根 .help-panel 元素 */
  el: HTMLElement;
  /** 标题栏元素（含标题 + 关闭按钮） */
  headerEl: HTMLElement;
  /** Body 空容器 — 面板模块自行填充内容 */
  bodyEl: HTMLElement;
  /** 显示面板（触发互斥） */
  show(): void;
  /** 隐藏面板 */
  hide(): void;
  /** 移除 DOM 并从缓存中注销 */
  destroy(): void;
}
