/** MathVisual Block 数据类型 */

/** 函数绘图类型 */
export type PlotType = 'y-of-x' | 'vertical-line' | 'parametric' | 'polar';

/** 一条函数曲线 */
export interface FunctionEntry {
  id: string;
  expression: string;       // mathjs 语法；垂直线为常数值；参数方程为 "x(t);y(t)"；极坐标为 "r(theta)"
  label: string;            // 显示标签，如 "f(x)"
  color: string;            // 曲线颜色
  style: 'solid' | 'dashed' | 'dotted';
  lineWidth: number;        // 线宽 px
  visible: boolean;
  showDerivative: boolean;
  plotType?: PlotType;      // 默认 'y-of-x'
  paramDomain?: [number, number]; // 参数方程 t 范围 / 极坐标 θ 范围，默认 [0, 2π]
  sourceLatex?: string;     // 来源 LaTeX（拖入时保留）
  sourceAtomId?: string;    // 来源 mathBlock/mathInline 的 atomId
}

/** 可调参数（所有曲线共享） */
export interface Parameter {
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
}

/** 关键点标注 */
export interface Annotation {
  x: number;
  functionId: string;       // 标注在哪条曲线上
  label: string;
  showCoord?: boolean;      // 是否显示坐标值
  color?: string;           // 自定义颜色
}

/** 切线 */
export interface TangentLine {
  id: string;
  functionId: string;
  x: number;                // 切点 x 坐标
  fixed: boolean;           // 是否固定（false = 可拖动）
  showSlope: boolean;       // 是否显示斜率值
  color?: string;
}

/** 法线 */
export interface NormalLine {
  id: string;
  functionId: string;
  x: number;                // 法线点 x 坐标
  fixed: boolean;           // 是否固定（false = 可拖动）
  showSlope: boolean;       // 是否显示斜率值
  color?: string;
}

/** 积分区域 */
export interface IntegralRegion {
  id: string;
  functionId: string;
  a: number;                // 左边界
  b: number;                // 右边界
  color?: string;           // 填充颜色
  showValue: boolean;       // 是否显示面积数值
}

/** 特征点类型 */
export type FeaturePointType = 'maximum' | 'minimum' | 'zero' | 'inflection';

/** 特征点（极值/零点/拐点） */
export interface FeaturePoint {
  id: string;
  functionId: string;
  x: number;
  y: number;
  type: FeaturePointType;
  auto: boolean;            // 自动检测 vs 手动添加
}

/** 坐标比例模式 */
export type ScaleMode = 'fit' | '1:1' | 'free';

/** 角度单位 */
export type AngleUnit = 'rad' | 'deg';

/** 坐标轴配置 */
export interface AxisConfig {
  showAxes: boolean;        // 显示坐标轴
  showAxisArrows: boolean;  // 轴末端箭头
  xLabel: string;           // x 轴标签（如 "x", "t", "θ"）
  yLabel: string;           // y 轴标签（如 "y", "f(x)"）
  xStep: number | null;     // x 轴刻度步长，null=自动
  yStep: number | null;     // y 轴刻度步长，null=自动
  showNumbers: boolean;     // 显示刻度数字
}

/** 画布显示配置 */
export interface CanvasConfig {
  height: number;           // 画布高度 px
  scaleMode: ScaleMode;     // 比例模式
  showGrid: boolean;        // 显示网格
  gridStyle: 'solid' | 'dashed' | 'dotted';  // 网格线型
  axis: AxisConfig;         // 坐标轴配置
  angleUnit: AngleUnit;     // 角度单位（影响 sin/cos 等函数）
  pointSize: number;        // 标注点大小 px
  zoom: boolean;            // 允许滚轮缩放
  pan: boolean;             // 允许拖拽平移
}

/** 默认坐标轴配置 */
export const DEFAULT_AXIS_CONFIG: AxisConfig = {
  showAxes: true,
  showAxisArrows: true,
  xLabel: 'x',
  yLabel: 'y',
  xStep: null,
  yStep: null,
  showNumbers: true,
};

/** 默认画布配置 */
export const DEFAULT_CANVAS_CONFIG: CanvasConfig = {
  height: 350,
  scaleMode: 'fit',
  showGrid: true,
  gridStyle: 'solid',
  axis: DEFAULT_AXIS_CONFIG,
  angleUnit: 'rad',
  pointSize: 6,
  zoom: true,
  pan: true,
};

/** 全屏工具模式 */
export type ToolMode = 'move' | 'select' | 'annotate' | 'tangent' | 'normal' | 'integral' | 'feature' | 'export';

/** 标注点自动命名序列 */
export const ANNOTATION_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** MathVisual Block 完整数据 */
export interface MathVisualData {
  title?: string;             // 图表标题
  functions: FunctionEntry[];
  domain: [number, number];
  range: [number, number];
  parameters: Parameter[];
  annotations: Annotation[];
  canvas: CanvasConfig;
  // 全屏模式新增
  tangentLines?: TangentLine[];
  normalLines?: NormalLine[];
  integralRegions?: IntegralRegion[];
  featurePoints?: FeaturePoint[];
}

/** 自动分配色板 */
export const FUNCTION_COLORS = [
  '#2D7FF9', // 蓝
  '#00D4AA', // 青绿
  '#FF6B35', // 橙
  '#A855F7', // 紫
  '#EC4899', // 粉
  '#EAB308', // 黄
];

/** 标签序列 */
const LABELS = ['f', 'g', 'h', 'p', 'q', 'r', 's', 't', 'u', 'v'];

/** 创建默认函数条目 */
export function createFunctionEntry(
  index: number,
  expression = '',
  sourceLatex?: string,
): FunctionEntry {
  return {
    id: String(Date.now()) + '-' + index,
    expression,
    label: `${LABELS[index % LABELS.length]}(x)`,
    color: FUNCTION_COLORS[index % FUNCTION_COLORS.length],
    style: 'solid',
    lineWidth: 2.5,
    visible: true,
    showDerivative: false,
    sourceLatex,
  };
}
