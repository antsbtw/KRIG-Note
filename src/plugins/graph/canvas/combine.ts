import { ShapeRegistry } from '../library/shapes';
import { SubstanceRegistry } from '../library/substances';
import type {
  Instance, SubstanceDef, SubstanceComponent,
} from '../library/types';
import type { NodeRenderer } from './scene/NodeRenderer';

/**
 * Combine to Substance — 把多个 selected 实例打包成一个 SubstanceDef,
 * 并替换画板上的原实例为一个新 substance 实例
 *
 * 算法(spec Canvas.md §3.5):
 * 1. 取所有 selected shape 实例(line / substance 实例 v1 不参与组合,留 v1.1)
 * 2. 计算 bbox(所有 shape 的并集)
 * 3. 以 bbox 左上角为新 substance 的局部原点;每个 component 的 transform.x/y =
 *    inst.position - bbox.minXY
 * 4. 第一个 component 标 binding='frame'(给 magnet/visual_rules 引用)
 * 5. 写入 SubstanceRegistry(运行时注册;M1.5b 接持久化时同时存为 note)
 * 6. 删原 instances + 添加新 substance 实例(放 bbox 左上角,size = bbox.w x bbox.h)
 *
 * v1.4d 限制(留 v1.1):
 * - 跳过 line 和 substance 实例(只支持 shape 实例的"扁平"组合)
 * - 不嵌套 substance(component.type === 'shape' only)
 * - line 实例若两端都在 selected 内,理论上应一并打包,但 endpoints 引用关系
 *   要重映射到 substance 的内部组件 id,逻辑复杂,留 v1.1
 */

export interface CombineParams {
  selectedIds: string[];
  name: string;
  category: string;
  description: string;
}

export interface CombineResult {
  /** 创建的 substance id */
  substanceId: string;
  /** 替换后的画板上 substance 实例 id */
  newInstanceId: string;
  /** 组合时被吃掉的原 instance id 列表(已从画板上删除) */
  consumedIds: string[];
}

export function combineSelectedToSubstance(
  nr: NodeRenderer,
  params: CombineParams,
): CombineResult | null {
  // 1. 分两批收集:shape(填充 / 文本)+ line(端点绑两端 shape 的 magnet)
  //    要求:shape 至少 2 个;line 两端都必须在 selected 范围内,否则跳过
  const shapeInsts: Instance[] = [];
  const lineInsts: Instance[] = [];
  const selectedSet = new Set(params.selectedIds);

  for (const id of params.selectedIds) {
    const inst = nr.getInstance(id);
    if (!inst) continue;
    if (inst.type !== 'shape') continue;          // substance 实例不支持嵌套(留 v1.1)
    const shape = ShapeRegistry.get(inst.ref);
    if (!shape) continue;
    if (shape.category === 'line') {
      // line 实例必须有 endpoints,且两端 instance 都在 selected 内才一并打包
      if (!inst.endpoints) continue;
      const [a, b] = inst.endpoints;
      if (!selectedSet.has(a.instance) || !selectedSet.has(b.instance)) continue;
      lineInsts.push(inst);
    } else {
      // 普通 shape:必备 position + size
      if (!inst.position || !inst.size) continue;
      shapeInsts.push(inst);
    }
  }
  if (shapeInsts.length < 2) {
    console.warn('[combine] need at least 2 shape instances(line 端点必须都在 selected 里才一并打包)');
    return null;
  }

  // 2. 计算 bbox(只看 shape;line 跟着两端走,不影响 bbox)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const inst of shapeInsts) {
    const x1 = inst.position!.x;
    const y1 = inst.position!.y;
    const x2 = x1 + inst.size!.w;
    const y2 = y1 + inst.size!.h;
    if (x1 < minX) minX = x1;
    if (y1 < minY) minY = y1;
    if (x2 > maxX) maxX = x2;
    if (y2 > maxY) maxY = y2;
  }
  const bboxW = maxX - minX;
  const bboxH = maxY - minY;

  // 3a. 构造 shape components(相对原点 = bbox 左上角)
  const components: SubstanceComponent[] = shapeInsts.map((inst, i) => ({
    type: 'shape',
    ref: inst.ref,
    transform: {
      x: inst.position!.x - minX,
      y: inst.position!.y - minY,
      w: inst.size!.w,
      h: inst.size!.h,
    },
    style_overrides: inst.style_overrides as Record<string, unknown> | undefined,
    // 第一个标 frame(用户可以后期改)
    binding: i === 0 ? 'frame' : undefined,
  }));

  // 3b. 把 line 也加进 components,endpoints 重映射到 substance 内部 component index
  // shape components 的 instanceId → "comp:N" 映射
  const instanceIdToCompIdx = new Map<string, number>();
  shapeInsts.forEach((inst, i) => instanceIdToCompIdx.set(inst.id, i));

  for (const lineInst of lineInsts) {
    const [a, b] = lineInst.endpoints!;
    const aIdx = instanceIdToCompIdx.get(a.instance);
    const bIdx = instanceIdToCompIdx.get(b.instance);
    if (aIdx === undefined || bIdx === undefined) continue;
    components.push({
      type: 'shape',
      ref: lineInst.ref,
      transform: { x: 0, y: 0 },                  // line 端点驱动,transform 仅占位
      style_overrides: lineInst.style_overrides as Record<string, unknown> | undefined,
      endpoints: [
        { component: `comp:${aIdx}`, magnet: a.magnet },
        { component: `comp:${bIdx}`, magnet: b.magnet },
      ],
    });
  }

  // 4. 创建 SubstanceDef
  const substanceId = makeSubstanceId(params.name);
  const def: SubstanceDef = {
    id: substanceId,
    category: params.category,
    name: params.name,
    description: params.description || undefined,
    components,
    source: 'user',
    created_at: Date.now(),
  };
  SubstanceRegistry.register(def);

  // 5. 删原 instances(包括打包的 line)+ 添加新 substance 实例
  const consumedIds = [...shapeInsts.map((i) => i.id), ...lineInsts.map((i) => i.id)];
  for (const id of consumedIds) {
    nr.remove(id);
  }
  const newInstanceId = nr.nextInstanceId();
  nr.add({
    id: newInstanceId,
    type: 'substance',
    ref: substanceId,
    position: { x: minX, y: minY },
    size: { w: bboxW, h: bboxH },
  });

  return { substanceId, newInstanceId, consumedIds };
}

// ─────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────

/** 把 name 转 slug 后拼成 user.<slug>.<rand>;失败 fallback 'user.custom.<rand>' */
function makeSubstanceId(name: string): string {
  const slug = slugify(name) || 'custom';
  const rand = Math.random().toString(36).slice(2, 8);
  let id = `user.${slug}.${rand}`;
  // 极小概率冲突时再 roll 一次
  while (SubstanceRegistry.get(id) !== null) {
    id = `user.${slug}.${Math.random().toString(36).slice(2, 8)}`;
  }
  return id;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9一-龥]+/g, '-')   // 保留中文 + 英数
    .replace(/^-+|-+$/g, '');
}
