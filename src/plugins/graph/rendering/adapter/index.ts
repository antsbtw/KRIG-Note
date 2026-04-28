/**
 * Adapter — DB record → RenderableScene。
 *
 * 这是 Basic Graph 渲染层与 atom 表的**唯一桥梁**。
 * adapter 之后所有代码（renderer / scene / shapes / labels）都不读 atom。
 *
 * 详见 memory/project_basic_graph_view_only.md
 *
 * 数据流：
 *   { graph, geometries, intensions, presentations }
 *      ↓
 *   按 subject_id 分组 atoms
 *      ↓
 *   for each geometry:
 *     从 intension 找 substance 引用 → substanceResolver
 *     用 composer 合成 visual
 *     从 intension 找 label 内容
 *     从 presentation 取 position + pinned
 *      ↓
 *   返回 RenderableScene
 */
import type {
  GraphRecord,
  GraphGeometryRecord,
  GraphIntensionAtomRecord,
  GraphPresentationAtomRecord,
} from '../../../../main/storage/types';
import type { Substance } from '../../substance/types';
import type { RenderableInstance, RenderableScene } from './types';
import { composeVisual } from './composer';
import { isInLayoutFamily } from '../../layout/layout-family';

export type SubstanceResolver = (id: string) => Substance | undefined;

export interface AdapterInput {
  graph: GraphRecord;
  geometries: GraphGeometryRecord[];
  intensions: GraphIntensionAtomRecord[];
  presentations: GraphPresentationAtomRecord[];
  /** 系统级 substance 解析器（必须）；v1.5+ 可叠加图谱级 substance */
  substanceResolver: SubstanceResolver;
  /** 当前 active layout id（决定取哪些 presentation atoms） */
  activeLayout: string;
  /** B3.4 新增：当前 active projection id（透传给 RenderableScene） */
  activeProjection?: string;
  /** B3.4 新增：layout 输出的边路由数据（透传给 RenderableScene） */
  edgeSections?: RenderableScene['edgeSections'];
}

export function adapt(input: AdapterInput): RenderableScene {
  const {
    graph, geometries, intensions, presentations, substanceResolver,
    activeLayout, activeProjection, edgeSections,
  } = input;
  const warnings: string[] = [];

  // ── 按 subject_id 分组 atoms（O(N) 一次） ──
  const intensionsBySubject = new Map<string, GraphIntensionAtomRecord[]>();
  for (const a of intensions) {
    const list = intensionsBySubject.get(a.subject_id) ?? [];
    list.push(a);
    intensionsBySubject.set(a.subject_id, list);
  }

  const presentationsBySubject = new Map<string, GraphPresentationAtomRecord[]>();
  for (const p of presentations) {
    // 仅保留 layout='*' 或 activeLayout 家族的 atom（spec §1.5；B4.2 加 family 兼容）
    if (!isInLayoutFamily(p.layout_id, activeLayout)) continue;
    const list = presentationsBySubject.get(p.subject_id) ?? [];
    list.push(p);
    presentationsBySubject.set(p.subject_id, list);
  }

  // ── 逐 geometry 合成 RenderableInstance ──
  const instances: RenderableInstance[] = [];

  for (const g of geometries) {
    const subjectIntensions = intensionsBySubject.get(g.id) ?? [];
    const subjectPresentations = presentationsBySubject.get(g.id) ?? [];

    // 提取 substance 引用
    const substanceAtom = subjectIntensions.find((i) => i.predicate === 'substance');
    let substance: Substance | undefined;
    if (substanceAtom) {
      substance = substanceResolver(substanceAtom.value);
      if (!substance) {
        warnings.push(`substance "${substanceAtom.value}" not found for geometry ${g.id}`);
      }
    }

    // 合成视觉
    const presentationAttrs = subjectPresentations.map((p) => ({
      attribute: p.attribute,
      value: p.value,
    }));
    const visual = composeVisual(g.kind, substance, presentationAttrs);

    // 提取 label
    const labelAtom = subjectIntensions.find((i) => i.predicate === 'label');
    const label = labelAtom?.value;

    // 提取 position + pinned
    let posX = 0;
    let posY = 0;
    let posZ: number | undefined;
    let pinned = false;
    for (const p of subjectPresentations) {
      if (p.attribute === 'position.x') posX = parseFloat(p.value);
      else if (p.attribute === 'position.y') posY = parseFloat(p.value);
      else if (p.attribute === 'position.z') posZ = parseFloat(p.value);
      else if (p.attribute === 'pinned' && p.value === 'true') pinned = true;
    }

    instances.push({
      id: g.id,
      kind: g.kind,
      visual,
      label,
      position: posZ !== undefined ? { x: posX, y: posY, z: posZ } : { x: posX, y: posY },
      members: g.members,
      pinned,
    });
  }

  return {
    graphId: graph.id,
    graphTitle: graph.title,
    dimension: graph.dimension ?? 2,
    activeLayout,
    activeProjection,
    instances,
    edgeSections,
    warnings,
  };
}

// 导出类型给 GraphRenderer / GraphView 用
export type { RenderableInstance, RenderableScene, ResolvedVisual } from './types';
export { composeVisual } from './composer';
