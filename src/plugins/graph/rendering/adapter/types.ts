/**
 * RenderableInstance — Basic Graph 接受的渲染态输入。
 *
 * 不是 DB record，不读 atom；adapter 把 DB 数据 + substance 合成成这个形态。
 * GraphRenderer 只接受 RenderableInstance[]，不知道 atom 表存在。
 *
 * 详见 docs/graph/KRIG-Graph-Import-Spec.md §1.6 渲染合成顺序
 *      + memory: project_basic_graph_view_only.md
 */
import type { GeometryKind } from '../../substance/types';

/** 已合成完整视觉参数（默认 ⊕ substance.visual ⊕ presentation atom） */
export interface ResolvedVisual {
  shape?: string;             // basic shape id：'circle' / 'hexagon' / ...
  fill?: { color?: string; opacity?: number };
  border?: { color?: string; width?: number; style?: 'solid' | 'dashed' | 'dotted' };
  text?: { color?: string; size?: number; font?: string; weight?: number };
  size?: { width?: number; height?: number; depth?: number };
  icon?: string;
  /** basic LabelLayout id：'inside-center' / 'below-center' / ... */
  labelLayout?: string;
  labelMargin?: number;
  /** 边方向 / 箭头（仅 line 读） */
  arrow?: 'none' | 'forward' | 'backward' | 'both';
  arrowSize?: number;
}

/**
 * 一个可渲染的几何体实例。
 *
 * GraphRenderer 收到 instances 数组后渲染：
 *   for each instance:
 *     根据 kind + shape 选 ShapeRenderer.createMesh
 *     根据 labelLayout + label 算 anchor + 渲染 label
 *     按 position 摆放
 */
export interface RenderableInstance {
  /** geometry id（DB id），用于后续拖动 / 选中等回写 */
  id: string;

  /** 几何类型 */
  kind: GeometryKind;

  /** 已合成的视觉参数 */
  visual: ResolvedVisual;

  /** label 内容（来自 intension atom predicate=label）；undefined = 无 label */
  label?: string;

  /** 位置：Point 必有；Line/Surface 由 members 派生（这里给 0,0 占位） */
  position: { x: number; y: number; z?: number };

  /** Line / Surface 用：members 引用的几何体 id（指向其它 RenderableInstance.id） */
  members: string[];

  /** 是否被钉住（不参与布局算法重排） */
  pinned?: boolean;
}

/**
 * 完整可渲染场景（GraphRenderer.setData 的输入）。
 */
export interface RenderableScene {
  /** graph 元数据 */
  graphId: string;
  graphTitle: string;
  /** 维度（2 或 3，v1 仅 2） */
  dimension: 2 | 3;
  /** 当前 active layout id */
  activeLayout: string;

  /** 所有几何体实例（按 id 索引可在 Map 里查） */
  instances: RenderableInstance[];

  /** 解析过程的警告（adapter 可能发现 ref 不存在等） */
  warnings: string[];
}
