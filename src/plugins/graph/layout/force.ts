/**
 * Force 布局算法 — 基于 d3-force 的力导向布局。
 *
 * 力配置：
 *   - link：边把端点拉近（按关系类型可调强度，v1 统一强度）
 *   - charge：节点之间排斥（避免重叠）
 *   - center：把图整体拉向画布中心
 *   - collide：碰撞力，防止节点贴在一起
 *
 * pin 处理：
 *   - presentation atom 中 pinned='true' 的 Point → 锁定其 fx/fy（d3-force 不动它）
 *   - 同时读 position.x/y 作为锁定位置
 *
 * 同步执行：
 *   - 跑 300 次 tick 后停止（足够小图收敛）
 *   - 不暴露 simulation 的实时动画（v1 是"算完一次性出位置"模型，
 *     v1.5+ 可改为分步 tick + 动画过渡）
 */
import * as d3 from 'd3-force';
import { layoutRegistry } from './registry';
import type { LayoutAlgorithm, LayoutInput, LayoutOutput } from './types';

const TICKS = 300;
const LINK_DISTANCE = 160;
const CHARGE_STRENGTH = -400;
const COLLIDE_RADIUS = 50;

interface ForceNode extends d3.SimulationNodeDatum {
  id: string;
}

interface ForceLink extends d3.SimulationLinkDatum<ForceNode> {
  source: string | ForceNode;
  target: string | ForceNode;
}

const force: LayoutAlgorithm = {
  id: 'force',
  label: 'Force',
  supportsDimension: [2],
  compute(input: LayoutInput): LayoutOutput {
    const points = input.geometries.filter((g) => g.kind === 'point');
    const lines = input.geometries.filter((g) => g.kind === 'line');
    const positions = new Map<string, { x: number; y: number }>();

    if (points.length === 0) return { positions };

    // ── 收集 pin / 已记录位置（force layout 专属，layout_id='force' 或 '*'） ──
    const pins = new Map<string, { x: number; y: number; pinned: boolean }>();
    for (const p of input.presentations) {
      if (p.layout_id !== 'force' && p.layout_id !== '*') continue;
      const cur = pins.get(p.subject_id) ?? { x: 0, y: 0, pinned: false };
      if (p.attribute === 'position.x') cur.x = parseFloat(p.value);
      else if (p.attribute === 'position.y') cur.y = parseFloat(p.value);
      else if (p.attribute === 'pinned') cur.pinned = p.value === 'true';
      pins.set(p.subject_id, cur);
    }

    // ── 构造 d3-force 数据 ──
    const nodes: ForceNode[] = points.map((p) => {
      const pin = pins.get(p.id);
      const node: ForceNode = { id: p.id };
      if (pin) {
        // 已记录位置 = 初始位置（即使没 pinned）
        node.x = pin.x;
        node.y = pin.y;
        // pinned=true → 固定（d3-force 检查 fx/fy 决定是否更新）
        if (pin.pinned) {
          node.fx = pin.x;
          node.fy = pin.y;
        }
      }
      return node;
    });

    const nodeIds = new Set(points.map((p) => p.id));
    // Line members 引用 Point id；过滤掉指向不存在 Point 的 Line（虽然解析器已校验，多一层防御）
    const links: ForceLink[] = lines
      .filter((l) => l.members.length >= 2 && nodeIds.has(l.members[0]) && nodeIds.has(l.members[1]))
      .map((l) => ({ source: l.members[0], target: l.members[1] }));

    // ── 力配置 ──
    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink<ForceNode, ForceLink>(links).id((d) => d.id).distance(LINK_DISTANCE))
      .force('charge', d3.forceManyBody().strength(CHARGE_STRENGTH))
      .force('center', d3.forceCenter(0, 0))
      .force('collide', d3.forceCollide(COLLIDE_RADIUS))
      .stop();

    // 同步跑 N 次 tick
    for (let i = 0; i < TICKS; i++) sim.tick();

    // 收集结果
    for (const n of nodes) {
      positions.set(n.id, {
        x: n.x ?? 0,
        y: n.y ?? 0,
      });
    }
    return { positions };
  },
};

layoutRegistry.register(force);
