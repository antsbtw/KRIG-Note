/**
 * ELK Adapter — 三个 layout 共享的输入/输出转换。
 *
 * 输入：KRIG LayoutInput（geometries + intensions + measureLabel）
 *   ↓
 * ELK input：{ id, layoutOptions, children: [{id, width, height}], edges: [{id, sources, targets}] }
 *   ↓
 * elk.layout()
 *   ↓
 * ELK output：{ children: [{id, x, y}], edges: [{sections: [{startPoint, endPoint, bendPoints}]}] }
 *   ↓
 * 输出：KRIG LayoutOutput（positions + edgeSections）
 *
 * 详见 docs/graph/KRIG-Graph-Layout-Spec.md §2 + §3
 *
 * 节点尺寸（label-aware sizing）由 getInstanceBoxSize 工具计算 — B3.4.5 实现；
 * B3.4.2 暂用 substance.visual.size 兜底。
 */
import { getElk, type ElkNode, type LayoutOptions } from './elk-runner';
import type { LayoutInput, LayoutOutput, EdgeSection } from './types';
import { getInstanceBoxSize, DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from './instance-size';
import { isInLayoutFamily } from './layout-family';

export interface ElkAdapterOptions {
  /** ELK 算法 id：'force' / 'box' / 'mrtree' / 'layered' / ... */
  elkAlgorithm: string;
  /**
   * KRIG layout id（'force' / 'grid' / 'tree-hierarchy' / ...）。
   * 用于 readPinnedPosition 识别"当前 layout 专属"的 presentation atom。
   * 不传 → 仅识别 layout_id='*'。
   */
  currentLayoutId?: string;
  /** 额外 layoutOptions（每个算法可定制） */
  extraOptions?: LayoutOptions;
}

/**
 * 跑一次 ELK 布局，返回 KRIG LayoutOutput。
 *
 * 输入处理：
 *   - 只把 Point 几何体当作 ELK 节点
 *   - Line 几何体转 ELK edge（取前两个 members 当 source / target）
 *   - 节点 width/height 来自 substance.visual.size，未声明用默认
 *   - measureLabel 命中时按 §7 padding 规则（B3.4.5 实装）
 *
 * 输出处理：
 *   - children[].{x, y} → positions（中心点：ELK 给的是左上角 + width/height）
 *   - edges[].sections → edgeSections（按 line geometry id 索引）
 */
export async function runElkLayout(
  input: LayoutInput,
  opts: ElkAdapterOptions,
): Promise<LayoutOutput> {
  const positions = new Map<string, { x: number; y: number; z?: number }>();
  const edgeSections = new Map<string, EdgeSection[]>();

  const points = input.geometries.filter((g) => g.kind === 'point');
  const lines = input.geometries.filter((g) => g.kind === 'line');
  if (points.length === 0) return { positions, edgeSections };

  // ── 构造 ELK 节点 ──
  const elkChildren: ElkNode[] = points.map((p) => {
    const size = getNodeSize(p.id, input);
    const pinPos = readPinnedPosition(p.id, input, opts.currentLayoutId);
    const node: ElkNode = {
      id: p.id,
      width: size.width,
      height: size.height,
    };
    // pinned 节点：用 'fixed' 位置；ELK layered 不支持但 'force' 可读初始位置
    if (pinPos) {
      node.x = pinPos.x - size.width / 2;
      node.y = pinPos.y - size.height / 2;
    }
    return node;
  });

  const pointIds = new Set(points.map((p) => p.id));

  // ── 构造 ELK 边（仅 Line 且首尾在节点集里） ──
  const elkEdges = lines
    .filter((l) => l.members.length >= 2 && pointIds.has(l.members[0]) && pointIds.has(l.members[1]))
    .map((l) => ({
      id: l.id,
      sources: [l.members[0]],
      targets: [l.members[1]],
    }));

  const root: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': opts.elkAlgorithm,
      ...opts.extraOptions,
    },
    children: elkChildren,
    edges: elkEdges as ElkNode['edges'],
  };

  const elk = getElk();
  let result: ElkNode;
  try {
    result = (await elk.layout(root)) as ElkNode;
  } catch (err) {
    console.error('[elk-adapter] layout failed:', err);
    return { positions, edgeSections };
  }

  // ── 解析 ELK 输出：节点位置（中心点） ──
  for (const child of result.children ?? []) {
    if (child.x === undefined || child.y === undefined) continue;
    const w = child.width ?? DEFAULT_NODE_WIDTH;
    const h = child.height ?? DEFAULT_NODE_HEIGHT;
    positions.set(child.id, {
      x: child.x + w / 2,
      y: -(child.y + h / 2),  // 翻 y：ELK y 向下，KRIG/Three.js y 向上
    });
  }

  // ── 解析 ELK 输出：边路由 sections ──
  for (const edge of (result.edges ?? []) as Array<{ id: string; sections?: Array<{ startPoint: { x: number; y: number }; endPoint: { x: number; y: number }; bendPoints?: Array<{ x: number; y: number }> }> }>) {
    if (!edge.sections || edge.sections.length === 0) continue;
    const sections: EdgeSection[] = edge.sections.map((s) => ({
      startPoint: { x: s.startPoint.x, y: -s.startPoint.y },
      endPoint: { x: s.endPoint.x, y: -s.endPoint.y },
      bendPoints: (s.bendPoints ?? []).map((b) => ({ x: b.x, y: -b.y })),
    }));
    edgeSections.set(edge.id, sections);
  }

  return { positions, edgeSections };
}

/**
 * 计算节点尺寸。
 *
 * B3.4.5：调 getInstanceBoxSize（按 labelLayout 方位加 padding）。
 * 详见 docs/graph/KRIG-Graph-Layout-Spec.md §7.7
 */
function getNodeSize(geometryId: string, input: LayoutInput): { width: number; height: number } {
  // 找 substance：从 intension atoms 找 'substance' predicate
  let substanceId: string | undefined;
  for (const atom of input.intensions) {
    if (atom.subject_id === geometryId && atom.predicate === 'substance') {
      substanceId = String(atom.value);
      break;
    }
  }
  const substance = substanceId ? input.substanceResolver(substanceId) : undefined;
  const labelBbox = input.measureLabel?.(geometryId);
  return getInstanceBoxSize(substance, labelBbox);
}

/**
 * 从 presentations 读 pinned 节点的位置（'*' 或当前 layout 专属）。
 *
 * - layout_id === '*'：跨布局共享，所有 layout 都消费
 * - layout_id === currentLayoutId：当前 layout 专属
 * - 其他 layout_id：忽略（避免 force 的 pinned 干扰 tree 布局）
 */
function readPinnedPosition(
  geometryId: string,
  input: LayoutInput,
  currentLayoutId: string | undefined,
): { x: number; y: number } | null {
  let x: number | undefined;
  let y: number | undefined;
  let pinned = false;
  for (const p of input.presentations) {
    if (p.subject_id !== geometryId) continue;
    if (!isInLayoutFamily(p.layout_id, currentLayoutId)) continue;
    if (p.attribute === 'position.x') x = parseFloat(p.value);
    else if (p.attribute === 'position.y') y = parseFloat(p.value);
    else if (p.attribute === 'pinned') pinned = p.value === 'true';
  }
  if (!pinned || x === undefined || y === undefined) return null;
  return { x, y };
}
