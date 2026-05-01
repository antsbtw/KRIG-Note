/**
 * Library 类型源 — Shape + Substance 数据结构
 * 严格对齐 docs/graph/library/Library.md §2.1(ShapeDef)和 §3.1(SubstanceDef)
 */

// ─────────────────────────────────────────────────────────
// Shape
// ─────────────────────────────────────────────────────────

export type ShapeCategory = 'basic' | 'arrow' | 'flowchart' | 'line' | 'text';
export type RendererKind = 'parametric' | 'static-svg' | 'custom';
export type AspectKind = 'variable' | 'fixed';
export type ParamUnit = 'ratio' | 'px' | 'deg';
export type ShapeSource = 'builtin' | 'plugin' | 'imported';

/** 公式中可出现的值:数字字面量、字符串(内置标识符 / 公式名)、嵌套公式 op */
export type FormulaValue = number | string | FormulaOp;

/**
 * OOXML 17 个操作符之一(详见 Library §2.2)
 * args 元素本身可以是字面量或嵌套 op,允许递归表达式
 */
export interface FormulaOp {
  op:
    | '*/' | '+-' | '+/' | 'abs' | 'sqrt' | 'mod' | 'pin'
    | 'max' | 'min' | 'val' | 'sin' | 'cos' | 'tan'
    | 'at2' | 'cat2' | 'sat2' | '?:';
  args: FormulaValue[];
}

export interface ShapeParam {
  type: 'number';
  default: number;
  min?: number;
  max?: number;
  label?: string;
  unit?: ParamUnit;
}

export interface ShapeGuide {
  name: string;
  op: FormulaOp['op'];
  args: FormulaValue[];
}

/**
 * 路径命令(对齐 SVG + OOXML pathLst)
 * 每个坐标参数都可以是数字或公式标识符
 */
export type PathCmd =
  | { cmd: 'M'; x: FormulaValue; y: FormulaValue }
  | { cmd: 'L'; x: FormulaValue; y: FormulaValue }
  | {
      cmd: 'A';
      rx: FormulaValue;
      ry: FormulaValue;
      x: FormulaValue;
      y: FormulaValue;
      'large-arc-flag'?: 0 | 1;
      'sweep-flag'?: 0 | 1;
    }
  | { cmd: 'Q'; x1: FormulaValue; y1: FormulaValue; x: FormulaValue; y: FormulaValue }
  | {
      cmd: 'C';
      x1: FormulaValue; y1: FormulaValue;
      x2: FormulaValue; y2: FormulaValue;
      x: FormulaValue;  y: FormulaValue;
    }
  | { cmd: 'Z' };

export interface MagnetPoint {
  id: string;
  x: number;  // 归一化 0..1
  y: number;
}

export interface ShapeHandle {
  param: string;
  axis: 'x' | 'y';
  from: FormulaValue;
  min?: FormulaValue;
  max?: FormulaValue;
}

export interface TextBox {
  l: FormulaValue;
  t: FormulaValue;
  r: FormulaValue;
  b: FormulaValue;
}

export type DashType = 'solid' | 'dash' | 'dot' | 'dashDot' | 'longDash';
export type ArrowEndKind =
  | 'none' | 'arrow' | 'triangle' | 'diamond' | 'oval' | 'stealth';

export interface FillStyle {
  type: 'none' | 'solid';
  color?: string;
  transparency?: number; // 0..1
}

export interface LineStyle {
  type: 'none' | 'solid';
  color?: string;
  width?: number;
  dashType?: DashType;
}

export interface ArrowStyle {
  begin?: ArrowEndKind;
  end?: ArrowEndKind;
}

export interface DefaultStyle {
  fill?: FillStyle;
  line?: LineStyle;
  arrow?: ArrowStyle;
}

/**
 * Shape 定义(JSON schema 镜像)
 * 90% shape 用 parametric renderer,纯 JSON 描述;custom 用 implementation 字段
 */
export interface ShapeDef {
  id: string;                  // krig.{category}.{name}
  category: ShapeCategory;
  name: string;
  renderer: RendererKind;

  viewBox: { w: number; h: number };
  aspect: AspectKind;

  params?: Record<string, ShapeParam>;
  guides?: ShapeGuide[];
  path?: PathCmd[];

  /** static-svg renderer 用 */
  svg_string?: string;

  /** custom renderer 用,指向 TS 模块路径 */
  implementation?: string;

  magnets?: MagnetPoint[];
  handles?: ShapeHandle[];
  textBox?: TextBox;
  default_style?: DefaultStyle;

  source: ShapeSource;
}

// ─────────────────────────────────────────────────────────
// Substance
// ─────────────────────────────────────────────────────────

export type SubstanceSource = 'builtin' | 'user';

export interface ComponentTransform {
  x: number;
  y: number;
  w?: number;
  h?: number;
  rotation?: number;
  anchor?: 'topLeft' | 'center' | 'bottomRight';
}

/**
 * Line component 的内部端点引用:
 * - "comp:N" — 引用同一 substance 内 components[N] 的某 magnet
 * 例:{ component: 'comp:0', magnet: 'E' } = 第 0 个 component 的 East magnet
 */
export interface SubstanceLineEndpoint {
  /** "comp:N" 形式,N 是同一 substance components 数组的下标 */
  component: string;
  /** magnet id(N/S/E/W 等) */
  magnet: string;
}

export interface SubstanceComponent {
  type: 'shape' | 'substance';
  ref: string;                          // shape id 或 substance id
  transform: ComponentTransform;
  style_overrides?: Record<string, unknown>;
  /** 组件在 substance 内的角色(供 visual_rules 和 variant 引用) */
  binding?: string;                     // 如 'frame' | 'label' | 'icon'
  /** line 类 component 用:两端绑同 substance 内其他 component 的 magnet */
  endpoints?: [SubstanceLineEndpoint, SubstanceLineEndpoint];
}

export interface VisualRule {
  if: string;                           // 表达式字符串,运行时 eval
  apply: Record<string, unknown>;       // path-style key → value
}

export interface SubstanceDef {
  id: string;
  category?: string;
  name: string;
  description?: string;

  components: SubstanceComponent[];
  default_props?: Record<string, unknown>;
  visual_rules?: VisualRule[];

  source: SubstanceSource;
  created_at?: number;
  created_by?: string;
}

// ─────────────────────────────────────────────────────────
// Registry / 渲染
// ─────────────────────────────────────────────────────────

export interface RenderContext {
  /** 节点目标尺寸(覆盖 viewBox) */
  width: number;
  height: number;
  /** 用户调整的参数值,覆盖 ShapeParam.default */
  params?: Record<string, number>;
}

export interface RenderOutput {
  /** 渲染产物的中性表示;由具体 renderer 填充 */
  kind: 'svg-path' | 'three-mesh' | 'composite';
  data: unknown;
}

export interface ShapePack {
  id: string;                           // pack 自己的 id(命名空间)
  shapes: ShapeDef[];
}

export interface SubstancePack {
  id: string;
  substances: SubstanceDef[];
}

// ─────────────────────────────────────────────────────────
// Canvas instance(画板上的"实例" — 已实例化的 shape / substance)
// 严格对齐 docs/graph/canvas/Canvas.md §4.1
// ─────────────────────────────────────────────────────────

export type InstanceKind = 'shape' | 'substance';

/**
 * 文字节点的语义内容类型(M2.1 引入).
 *
 * 与 NoteView 同源:本质是 src/shared/types/atom-types.ts 的 Atom[].
 * 此处用 unknown[] 是因为 library/types.ts 是图层基础类型,不应直接依赖
 * note 模块;消费方(渲染层 / 编辑层)做 import + 类型断言.
 *
 * 详见 docs/graph/canvas/Canvas-M2.1-TextNode-Spec.md §1
 */
export type TextNodeAtoms = unknown[];

export interface InstanceEndpoint {
  /** 连接到哪个 instance 的 id */
  instance: string;
  /** 连到该 instance 的哪个 magnet(N/S/E/W/START/END/...) */
  magnet: string;
}

/**
 * Canvas note 中的一个节点实例。
 *
 * shape / substance 实例:用 position + size 定位
 * line 实例:可用 endpoints(由两端 magnet 驱动,M1.2c)
 *           也可用 position + size(用户手动定位,无 magnet 跟随)
 */
export interface Instance {
  id: string;
  type: InstanceKind;
  /** 引用 Library 中的 shape / substance id */
  ref: string;

  /** 非 line 实例必备;line 实例若有 endpoints 可省略 */
  position?: { x: number; y: number };
  size?: { w: number; h: number };

  /**
   * 旋转(度数;顺时针方向 = 用户视觉的"顺时针")
   * 缺省 = 0(无旋转);旋转中心 = bbox 中心(position + size/2)
   */
  rotation?: number;

  /** line 实例两端连接 */
  endpoints?: [InstanceEndpoint, InstanceEndpoint];

  /** 用户调整的参数(覆盖 ShapeDef.params 的 default) */
  params?: Record<string, number>;

  /** 覆盖默认样式(对齐 Canvas.md §4.1) */
  style_overrides?: {
    fill?: Partial<FillStyle>;
    line?: Partial<LineStyle>;
    arrow?: Partial<ArrowStyle>;
  };

  /** substance 实例的业务属性(姓名 / gender / birth / death 等) */
  props?: Record<string, unknown>;

  /**
   * 文字节点语义内容(M2.1 引入).
   *
   * 仅当 ref === 'krig.text.label' 时生效;格式 = NoteView 同源 Atom[]
   * (src/shared/types/atom-types.ts).扁平存储,parentId 关联,与 NoteView
   * 数据完全互通.
   *
   * 详见 docs/graph/canvas/Canvas-M2.1-TextNode-Spec.md §1.
   */
  doc?: TextNodeAtoms;
}
