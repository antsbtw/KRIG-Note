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
  /** 形状基础（引用 basic shape 注册表）：'circle' / 'box' / 'hexagon' / ... */
  shape?: string;
  fill?: { color?: string; opacity?: number };
  border?: { color?: string; width?: number; style?: 'solid' | 'dashed' | 'dotted' };
  text?: { color?: string; size?: number; font?: string; weight?: number };
  size?: { width?: number; height?: number; depth?: number };
  /** emoji / SVG path */
  icon?: string;

  /**
   * label 布局：引用 basic LabelLayout 注册表
   *   'inside-center' / 'inside-top'
   *   'above-center' / 'below-center'
   *   'left-of' / 'right-of'
   * 默认 'below-center'（v1）
   */
  labelLayout?: string;
  /** label margin（shape 边到 label 的距离）；不指定时用 layout 默认 */
  labelMargin?: number;

  /**
   * 边方向 / 箭头（仅 line 类 shape 读）
   *   'none'      无箭头（默认）
   *   'forward'   单向，箭头在末端（target 节点边缘）
   *   'backward'  反向，箭头在起点
   *   'both'      双向
   */
  arrow?: 'none' | 'forward' | 'backward' | 'both';
  /** 箭头大小（世界单位）；默认 10 */
  arrowSize?: number;
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

// ── B3 Pattern 扩展：Substance 升级为 "组合性 Substance"（详见 KRIG-Graph-Pattern-Spec.md §1）──

/**
 * 角色选择器：从图谱里找出"哪些子节点担当哪个角色"。
 *
 * 例（pattern-workspace）：
 *   roles.navside = { via: 'contains', requires_substance: 'krig-navside', arity: 'one' }
 *   = "通过 contains 关系连到我、且 substance 是 krig-navside 的那个子节点 = navside 角色"
 */
export interface RoleSelector {
  /** 通过哪种关系连到容器节点（intension atom 的 predicate id） */
  via: string;
  /** 子节点必须引用的 substance id（可选，进一步缩窄匹配范围） */
  requires_substance?: string;
  /** 期待 0..1 个还是 0..N 个 */
  arity: 'one' | 'many';
  /**
   * 是否必填（默认 false = 宽容）。
   *   true  ：缺这个角色 → Pattern 整体作废 → 容器内所有子节点走 fallback layout
   *   false ：缺这个角色 → 槽位留空，Pattern 仍然生效
   */
  required?: boolean;
}

/** 命名槽位位置 */
export type SlotPosition =
  | 'left' | 'right' | 'top' | 'bottom' | 'center'
  | { x: number; y: number };  // 自定义偏移（相对容器中心）

/**
 * Pattern 内部布局规则（Pattern Substance 的 pattern_layout 字段）。
 *
 *   slots:  把每个角色摆到容器内的命名位置（v1 实现）
 *   tree:   按 root_role / child_role 递归展开树形（v1.5+）
 *   custom: 引用注册到 patternLayoutRegistry 的自定义算法（v1.5+）
 */
export type PatternLayout =
  | { kind: 'slots'; assignments: Record<string, SlotPosition> }
  | { kind: 'tree'; root_role: string; child_role: string }
  | { kind: 'custom'; algorithm: string };

/**
 * Substance 来源层级（spec §1.3.8 三层架构）。
 *
 * 决定加载顺序、覆盖优先级、UI 分组：
 *   base：系统硬编码基类（不可删，不可改）
 *   built-in：KRIG 内置领域包（krig-software / chemistry / ...）
 *   theme：主题包（仅改 visual，不改语义）
 *   community：第三方 npm 包（v2.x 加载）
 *   user：用户本地 JSON 扩展（v2.x 加载）
 */
export type SubstanceOrigin = 'base' | 'built-in' | 'theme' | 'community' | 'user';

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

  // ── 三层架构扩展字段（spec §1.3.8）──
  // v1 不强制使用，但接口预留以支持未来 v2.x JSON 扩展机制
  /** 父 substance id（继承默认值；undefined = 直接继承基类） */
  extends?: string;
  /** 来源层级（用于 UI 分组 / 加载顺序）；v1 内置默认 'built-in' */
  origin?: SubstanceOrigin;
  /** 版本号（兼容性管理，v2.x 后用） */
  version?: string;
  /** 来源包名（v2.x 社区包 / 用户文件用） */
  pack?: string;

  visual?: SubstanceVisual;
  physical?: SubstancePhysical;
  chemical?: SubstanceChemical;
  behavior?: SubstanceBehavior;

  // ── B3 Pattern 扩展（仅 Pattern Substance 填）──
  /**
   * 角色定义：从图谱里找出"哪些子节点担当哪个角色"。
   * 简单 Substance 不填；填了就是 Pattern Substance（渲染管线走 Pattern 路径）。
   * 详见 docs/graph/KRIG-Graph-Pattern-Spec.md §1.2
   */
  roles?: Record<string, RoleSelector>;

  /**
   * 角色布局规则：每个角色摆在容器内哪个位置。
   * 与 roles 同时填或同时不填（v1 简化要求）。
   */
  pattern_layout?: PatternLayout;
}
