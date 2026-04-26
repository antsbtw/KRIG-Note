/**
 * Substance（物质）类型定义 — 视图的物理态。
 *
 * 几何（Geometry）= 数学态：圆 / 方 / 多边形 / 立方体（抽象形状）
 * 物质（Substance）= 物理态：钻石 / 水 / KRIG-Layer / Concept（客观世界投射）
 *
 * 几何体通过 intension atom `substance :: <id>` 引用一个 Substance，
 * 同时获得视觉默认值 + 物理 / 化学知识 + 行为提示。
 *
 * v1 仅读 visual 字段，physical / chemical / behavior 是预留命名空间，
 * 留给 v3.0+ 的物理仿真 / 推理 / 交互层使用。
 *
 * 详细设计见 docs/graph/KRIG-Graph-Import-Spec.md §1.3
 */

/** 几何体类型（4 种） */
export type GeometryKind = 'point' | 'line' | 'surface' | 'volume';

/** 视觉投射：substance 的默认渲染参数（presentation atom 可覆盖） */
export interface SubstanceVisual {
  /** 形状基础（'circle' / 'box' / 'hexagon' / 'sphere' / 'cube' / ...） */
  shape?: string;
  fill?: { color?: string; opacity?: number };
  border?: { color?: string; width?: number; style?: 'solid' | 'dashed' | 'dotted' };
  text?: { color?: string; size?: number; font?: string; weight?: number };
  size?: { width?: number; height?: number; depth?: number };
  /** emoji / SVG path */
  icon?: string;
}

/** 物理属性（v1 不读，v3.0+ 用于力导驱动 / 推理） */
export interface SubstancePhysical {
  density?: number;
  hardness?: number;
  /** 力导算法权重 */
  mass?: number;
  /** 力导算法电荷（同号排斥） */
  charge?: number;
  transparent?: boolean;
  [key: string]: unknown;
}

/** 化学 / 领域属性（v1 不读，v3.0+ 用于推理 / 搜索） */
export interface SubstanceChemical {
  formula?: string;
  crystal_system?: string;
  [key: string]: unknown;
}

/** 行为提示（v1 不读，v1.5+ 用于交互层） */
export interface SubstanceBehavior {
  clickable?: boolean;
  draggable?: boolean;
  expandable?: boolean;
  [key: string]: unknown;
}

/** 一种 Substance 的完整定义 */
export interface Substance {
  /** 全局唯一 id（'diamond' / 'krig-layer' / 'concept-default' ...） */
  id: string;
  /** UI 显示名 */
  label: string;
  /** 描述（用于物质库浏览面板） */
  description?: string;
  /** 限定可被哪些几何引用（默认全部） */
  applies_to_kinds?: GeometryKind[];

  visual?: SubstanceVisual;
  physical?: SubstancePhysical;
  chemical?: SubstanceChemical;
  behavior?: SubstanceBehavior;
}
