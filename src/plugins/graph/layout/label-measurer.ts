/**
 * Label Measurer — 测量 RenderableScene 中节点 label 的实际 SVG bbox。
 *
 * 用途：解决"substance.visual.size 设计期硬编码 vs label 实际渲染尺寸"的不一致。
 * KRIG label 是富内容（textBlock / mathBlock / list / 公式），实际尺寸只能渲染时
 * 才知道。详见 docs/graph/KRIG-Graph-Layout-Spec.md §7。
 *
 * 流程（异步背景任务，不阻塞首次渲染）：
 *   1. 遍历 instances 拿 label 字符串
 *   2. 用 SvgGeometryContent 跑一次 render → 获取 bbox
 *   3. 与 presentations 中已存的 label_bbox 对比，差异 > 阈值才写
 *   4. 把变更通过 graphPresentationSetBulk 持久化到 atom 表
 *   5. 返回内存 Map 给当前渲染流（不等下一次加载就生效）
 *
 * 缓存：SvgGeometryContent 内部三级缓存（atoms→SVG→Geometry），同样 label 内容
 *       重复测量几乎瞬间。
 */
import * as THREE from 'three';
import { SvgGeometryContent } from '../rendering/contents/SvgGeometryContent';
import { makeTextLabel } from '../../../lib/atom-serializers/extract';
import type {
  GraphPresentationAtomRecord,
} from '../../../main/storage/types';
import type { RenderableInstance } from '../rendering/adapter/types';

/** 1px 以内差异不写入 atom（避免无意义抖动写） */
const WRITE_THRESHOLD = 1;

export interface LabelBbox {
  width: number;
  height: number;
}

/** 持久化用的回调：把测出的 atom 写回 storage */
export type WriteBackFn = (records: Array<{
  graph_id: string;
  layout_id: string;
  subject_id: string;
  attribute: string;
  value: string;
  value_kind: 'number';
}>) => Promise<void> | void;

/**
 * 测量给定 instance 集合的 label bbox。
 *
 * 已有 atom 中 label_bbox.* 命中且差异 < WRITE_THRESHOLD → 跳过测量
 * 测量结果差异显著 → 加入待写入列表
 * 返回：完整的 id → bbox Map（含 atom 已有 + 新测量的）
 */
export async function measureLabels(args: {
  graphId: string;
  instances: RenderableInstance[];
  presentations: GraphPresentationAtomRecord[];
  writeBack: WriteBackFn;
}): Promise<Map<string, LabelBbox>> {
  const { graphId, instances, presentations, writeBack } = args;

  // ── 1. 读已有 atom 里的 label_bbox ──
  const existing = readExistingBbox(presentations);

  // ── 2. 跑测量 ──
  const result = new Map<string, LabelBbox>(existing);
  const toWrite: GraphPresentationAtomRecord[] = [];
  const renderer = new SvgGeometryContent();

  for (const inst of instances) {
    if (inst.kind !== 'point' || !inst.label) continue;
    const measured = await measureOne(renderer, inst.label);
    if (!measured) continue;

    result.set(inst.id, measured);

    const prev = existing.get(inst.id);
    const dW = prev ? Math.abs(prev.width - measured.width) : Infinity;
    const dH = prev ? Math.abs(prev.height - measured.height) : Infinity;
    if (dW < WRITE_THRESHOLD && dH < WRITE_THRESHOLD) continue;

    toWrite.push(
      makeBboxAtom(graphId, inst.id, 'width', measured.width),
      makeBboxAtom(graphId, inst.id, 'height', measured.height),
    );
  }

  // ── 3. 异步写回 atom（不等待，背景任务） ──
  if (toWrite.length > 0) {
    void writeBack(
      toWrite.map((r) => ({
        graph_id: r.graph_id,
        layout_id: r.layout_id,
        subject_id: r.subject_id,
        attribute: r.attribute,
        value: r.value,
        value_kind: 'number',
      })),
    );
  }

  return result;
}

/** 跑一次 SVG 渲染拿 bbox。失败返回 null。 */
async function measureOne(
  renderer: SvgGeometryContent,
  labelText: string,
): Promise<LabelBbox | null> {
  try {
    const obj = await renderer.render(makeTextLabel(labelText));
    const box = new THREE.Box3().setFromObject(obj);
    renderer.dispose(obj);  // 立刻释放：bbox 已拿到，不需要保留 mesh
    if (!Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) return null;
    if (box.isEmpty()) return null;
    return {
      width: Math.abs(box.max.x - box.min.x),
      height: Math.abs(box.max.y - box.min.y),
    };
  } catch (e) {
    console.warn('[label-measurer] measure failed for label', e);
    return null;
  }
}

/** 从 presentations 里读出 subject_id → bbox（layout_id='*'）。 */
export function readExistingBbox(
  presentations: GraphPresentationAtomRecord[],
): Map<string, LabelBbox> {
  const tmp = new Map<string, { width?: number; height?: number }>();
  for (const p of presentations) {
    if (p.layout_id !== '*') continue;
    if (p.attribute === 'label_bbox.width') {
      const cur = tmp.get(p.subject_id) ?? {};
      cur.width = parseFloat(p.value);
      tmp.set(p.subject_id, cur);
    } else if (p.attribute === 'label_bbox.height') {
      const cur = tmp.get(p.subject_id) ?? {};
      cur.height = parseFloat(p.value);
      tmp.set(p.subject_id, cur);
    }
  }
  const out = new Map<string, LabelBbox>();
  for (const [id, v] of tmp) {
    if (v.width !== undefined && v.height !== undefined) {
      out.set(id, { width: v.width, height: v.height });
    }
  }
  return out;
}

function makeBboxAtom(
  graphId: string,
  subjectId: string,
  axis: 'width' | 'height',
  value: number,
): GraphPresentationAtomRecord {
  return {
    id: `_lblbbox_${subjectId}_${axis}`,
    graph_id: graphId,
    layout_id: '*',
    subject_id: subjectId,
    attribute: `label_bbox.${axis}`,
    value: String(value),
    value_kind: 'number',
    updated_at: 0,
  };
}
