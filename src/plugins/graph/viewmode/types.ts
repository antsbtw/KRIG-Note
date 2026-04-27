/**
 * ViewMode 类型定义（B3 Layer 3 知识表示层）。
 *
 * ViewMode = 同一份图谱的某种整体视角：
 *   filter     哪些节点 / 边参与（默认全部）
 *   layout     位置算法（注册到 layoutRegistry）
 *   projection 渲染范式（注册到 projectionRegistry）
 *
 * 详见 docs/graph/KRIG-Graph-Pattern-Spec.md §2
 */

/** Filter（v1 极简：按 substance 包含/排除） */
export interface GraphFilter {
  include_substances?: string[];
  exclude_substances?: string[];
  // v1.5+ 支持更复杂的过滤
}

/** ViewMode 完整定义 */
export interface ViewMode {
  /** 唯一 id（'force' / 'tree' / 'grid' / ...） */
  id: string;
  /** UI 显示名 */
  label: string;
  /** 描述（用于切换器 tooltip） */
  description?: string;

  /** 哪些节点参与（默认全部） */
  filter?: GraphFilter;

  /** 布局算法 id（必须已注册到 layoutRegistry） */
  layout: string;

  /** 渲染范式 id（必须已注册到 projectionRegistry） */
  projection: string;

  /**
   * 是否启用 Pattern 系统：
   *   true  ：按 Pattern Substance 优先算群位置（默认）
   *   false ：跳过 Pattern，纯 layout 算位置（用于"原始视图"调试）
   */
  enable_patterns?: boolean;
}
