/**
 * Projection 接口（B3 Layer 3 渲染范式抽象）。
 *
 * v1 仅注册 'graph' projection（= 现有 shape + line + label 渲染管线）。
 * v1.5+ 注册：
 *   'tree'      缩进 + 父子连线
 *   'matrix'    N×N 格子热图
 *   'timeline'  时间轴 + 事件
 *   'table'     表格
 *
 * 详见 docs/graph/KRIG-Graph-Pattern-Spec.md §2.6
 *
 * v1 Projection 接口故意保持极简：只承诺"id + label"。
 * 真正"按 projection 切换不同渲染管线"的能力留给 v1.5+ —— 那时候
 * GraphRenderer 才会按 projection.id 选择不同的 mesh 构造路径。
 */

export interface Projection {
  /** 唯一 id（'graph' / 'tree' / 'matrix' / ...） */
  id: string;
  /** UI 显示名 */
  label: string;
  /** 描述 */
  description?: string;
}
