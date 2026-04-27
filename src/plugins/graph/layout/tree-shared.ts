/**
 * Tree projection 公用工具 — tree-hierarchy / tree-layered 共享。
 *
 * 职责：从 LayoutInput 中筛出"由 contains 衍生的 line geometry"，让 tree 类
 * 算法只把 contains 边当父→子方向；其他关系（refs / routes-to / defines / ...）
 * tree projection 不显示。
 */
import type { LayoutInput } from './types';

/** 找出所有"由 contains predicate 衍生"的 line geometry id。 */
export function collectContainsLineIds(input: LayoutInput): Set<string> {
  const containsPairs = new Set<string>();
  for (const atom of input.intensions) {
    if (atom.predicate !== 'contains') continue;
    containsPairs.add(`${atom.subject_id}→${String(atom.value)}`);
  }
  const result = new Set<string>();
  for (const g of input.geometries) {
    if (g.kind !== 'line' || g.members.length < 2) continue;
    const key = `${g.members[0]}→${g.members[1]}`;
    if (containsPairs.has(key)) result.add(g.id);
  }
  return result;
}

/** 过滤 LayoutInput 只保留 point + contains line。 */
export function filterToContainsTree(input: LayoutInput): LayoutInput {
  const containsLineIds = collectContainsLineIds(input);
  return {
    ...input,
    geometries: input.geometries.filter(
      (g) => g.kind !== 'line' || containsLineIds.has(g.id),
    ),
  };
}
