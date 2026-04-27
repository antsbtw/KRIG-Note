/**
 * Pattern Composer — 视图层的 Pattern 处理阶段。
 *
 * 在 layout 算法之前运行，识别图谱里引用了 Pattern Substance 的容器节点，
 * 按 substance.roles 匹配子节点，按 substance.pattern_layout 算子节点的槽位位置。
 *
 * 输出：
 *   - patternPositions: 已被 Pattern 管理的子节点位置（layout 不再处理这些）
 *   - excludedFromLayout: 从 layout 输入剔除的子节点 id 集合（避免重复算位置）
 *
 * 实现 docs/graph/KRIG-Graph-Pattern-Spec.md §3.1 步骤 ②（Pattern 先算群位置）。
 *
 * v1 限制（决议）：
 *   - 仅支持 PatternLayout.kind = 'slots'（命名槽位）
 *   - 仅一层（嵌套递归留 v1.5+）
 *   - 决议 4：外层 Pattern 只决定子节点位置，不动子节点视觉
 *   - 决议 5：required 默认 false；缺 required → 整体作废走 fallback
 *   - 决议 10：未匹配上 Pattern 的散户走后续 layout
 */
import type {
  GraphGeometryRecord,
  GraphIntensionAtomRecord,
} from '../../../main/storage/types';
import type {
  Substance,
  RoleSelector,
  SlotPosition,
} from '../substance/types';

export interface PatternComposeInput {
  geometries: GraphGeometryRecord[];
  intensions: GraphIntensionAtomRecord[];
  substanceResolver: (id: string) => Substance | undefined;
}

/** Pattern 处理过的子节点：相对容器中心的偏移 + 容器 id（合并阶段用） */
export interface PatternMember {
  containerId: string;
  offsetX: number;
  offsetY: number;
}

export interface PatternComposeOutput {
  /** key = 子节点 geometry id；值 = 容器引用 + 相对偏移 */
  members: Map<string, PatternMember>;
  /** 所有作为 Pattern 容器的节点 id（合并阶段把它们的 layout 位置应用到 members） */
  containers: Set<string>;
}

/**
 * 主入口：扫描所有引用了 Pattern Substance 的容器，按 roles + pattern_layout 算子节点位置。
 */
export function composePatterns(input: PatternComposeInput): PatternComposeOutput {
  const out: PatternComposeOutput = {
    members: new Map(),
    containers: new Set(),
  };

  // 索引：subject → 该 subject 的 intension atom 列表
  const atomsBySubject = new Map<string, GraphIntensionAtomRecord[]>();
  for (const atom of input.intensions) {
    let list = atomsBySubject.get(atom.subject_id);
    if (!list) {
      list = [];
      atomsBySubject.set(atom.subject_id, list);
    }
    list.push(atom);
  }

  // 找每个节点的 substance 引用
  function getSubstanceForNode(geomId: string): Substance | undefined {
    const atoms = atomsBySubject.get(geomId);
    if (!atoms) return undefined;
    const sub = atoms.find((a) => a.predicate === 'substance');
    if (!sub) return undefined;
    return input.substanceResolver(String(sub.value));
  }

  // 遍历每个 Point geometry，看它是不是 Pattern 容器
  for (const geom of input.geometries) {
    if (geom.kind !== 'point') continue;
    const substance = getSubstanceForNode(geom.id);
    if (!substance?.roles || !substance.pattern_layout) continue;

    // 这是 Pattern 容器；按 roles 匹配子节点
    const roleMatches = matchRoles(geom.id, substance, atomsBySubject, input.substanceResolver);
    if (!roleMatches) continue;  // required 角色缺失 → 整体作废

    // 容器位置由后续 layout 决定（容器作为顶级节点参与布局）。
    // 子节点的槽位以"相对容器中心的偏移"记录；GraphView 在 layout 后
    // 把容器位置加到偏移上得到子节点最终绝对位置（决议 9）。
    const slotOffsets = computeSlotOffsets(substance);

    for (const [roleName, members] of Object.entries(roleMatches)) {
      const offset = slotOffsets[roleName];
      if (!offset) continue;
      for (const memberId of members) {
        out.members.set(memberId, {
          containerId: geom.id,
          offsetX: offset.x,
          offsetY: offset.y,
        });
      }
    }
    out.containers.add(geom.id);
  }

  return out;
}

// ── 内部：角色匹配 ──

/**
 * 在容器 geom 的"contains-邻居"里按 RoleSelector 匹配每个角色的子节点。
 *
 * 返回：null = required 缺失（Pattern 整体作废）；否则 = role → memberIds[]
 */
function matchRoles(
  containerId: string,
  substance: Substance,
  atomsBySubject: Map<string, GraphIntensionAtomRecord[]>,
  substanceResolver: (id: string) => Substance | undefined,
): Record<string, string[]> | null {
  const result: Record<string, string[]> = {};
  if (!substance.roles) return result;

  const containerAtoms = atomsBySubject.get(containerId) ?? [];

  for (const [roleName, selector] of Object.entries(substance.roles)) {
    const candidates = findCandidatesByRelation(containerId, containerAtoms, selector);
    const matched = candidates.filter((cid) => {
      if (!selector.requires_substance) return true;
      const sub = getNodeSubstance(cid, atomsBySubject, substanceResolver);
      return sub?.id === selector.requires_substance;
    });

    if (selector.arity === 'one' && matched.length > 1) {
      // arity 'one' 但匹配到多个 → 取第一个（v1 简化，无歧义）
      result[roleName] = [matched[0]];
    } else if (matched.length > 0) {
      result[roleName] = matched;
    } else if (selector.required === true) {
      // required 缺失 → 整体作废
      return null;
    }
    // 非 required 缺失 → result 不包含该角色（槽位空着）
  }

  return result;
}

/**
 * 在容器的所有 intension atom 里找通过 selector.via 关系连出的子节点 id。
 *
 * v1 简化：predicate = selector.via 的 atom 的 value 视为子节点 id（value_kind='ref'）。
 */
function findCandidatesByRelation(
  _containerId: string,
  containerAtoms: GraphIntensionAtomRecord[],
  selector: RoleSelector,
): string[] {
  return containerAtoms
    .filter((a) => a.predicate === selector.via)
    .map((a) => String(a.value));
}

function getNodeSubstance(
  nodeId: string,
  atomsBySubject: Map<string, GraphIntensionAtomRecord[]>,
  substanceResolver: (id: string) => Substance | undefined,
): Substance | undefined {
  const atoms = atomsBySubject.get(nodeId);
  if (!atoms) return undefined;
  const sub = atoms.find((a) => a.predicate === 'substance');
  if (!sub) return undefined;
  return substanceResolver(String(sub.value));
}

// ── 内部：槽位偏移计算 ──

/**
 * 把 Pattern 的命名槽位转成"相对容器中心的世界坐标偏移"。
 *
 * v1 实现：left/right/top/bottom/center 用容器 size 的一半为半径；
 *         {x, y} 自定义偏移直接传递。
 */
function computeSlotOffsets(substance: Substance): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  if (substance.pattern_layout?.kind !== 'slots') return out;

  const w = substance.visual?.size?.width ?? 400;
  const h = substance.visual?.size?.height ?? 300;
  const halfW = w / 2;
  const halfH = h / 2;
  // 边距：让子节点稍微缩进，不贴在容器边缘
  const padW = halfW * 0.65;
  const padH = halfH * 0.65;

  for (const [role, pos] of Object.entries(substance.pattern_layout.assignments)) {
    out[role] = slotToOffset(pos, padW, padH);
  }
  return out;
}

function slotToOffset(pos: SlotPosition, padW: number, padH: number): { x: number; y: number } {
  if (typeof pos === 'object') return pos;
  switch (pos) {
    case 'left':   return { x: -padW, y: 0 };
    case 'right':  return { x:  padW, y: 0 };
    case 'top':    return { x: 0,     y:  padH };
    case 'bottom': return { x: 0,     y: -padH };
    case 'center': return { x: 0,     y: 0 };
  }
}
