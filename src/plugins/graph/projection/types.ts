/**
 * Projection 接口（B3 Layer 3 渲染范式抽象）。
 *
 * v1.7（B3.3）注册：'graph'（KRIG v1.4 默认渲染管线）
 * v1.8（B3.4）注册：'tree'  （ELK ORTHOGONAL 边路由的真树形）
 *
 * 后续 v1.9+：'matrix' / 'timeline' / 'table' / ...
 *
 * 详见 docs/graph/KRIG-Graph-Pattern-Spec.md §2.6
 *      docs/graph/KRIG-Graph-Layout-Spec.md §5
 *
 * Projection 介入边渲染通过 customizeLine：
 *   GraphRenderer 渲染每条 line geometry 前调 projection.customizeLine(...)
 *   返回 Vector3[] 作为路径点；返回 null 走原直线。
 */
import type * as THREE from 'three';
import type { RenderableInstance } from '../rendering/adapter/types';
import type { EdgeSection } from '../layout/types';

export interface Projection {
  /** 唯一 id（'graph' / 'tree' / 'matrix' / ...） */
  id: string;
  /** UI 显示名 */
  label: string;
  /** 描述 */
  description?: string;

  /**
   * B3.4 新增：边路由风格 hint（信息性，告诉 ViewMode 切换器该图谱该用什么 layout 配置）。
   * v1.8 'tree' = orthogonal；'graph' = straight。
   * 后续 splines / polyline 留 v1.9+。
   */
  edgeStyle?: 'orthogonal' | 'splines' | 'polyline' | 'straight';

  /**
   * B3.4 新增：让 projection 介入边渲染。
   *
   * 输入：line instance + 由 layout 输出（LayoutOutput.edgeSections）暂存的 ELK 边路由数据。
   * 输出：替代直线的折线/曲线点序列（Three.js 世界坐标 z 由 GraphRenderer 设置）。
   *       返回 null 表示不介入 → 走原直线渲染。
   */
  customizeLine?(
    inst: RenderableInstance,
    sections: EdgeSection[] | undefined,
  ): Array<{ x: number; y: number }> | null;
}
