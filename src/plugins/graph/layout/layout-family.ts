/**
 * Layout 家族 — 共享 atom 命名空间的 layout id 集合（B4.2）。
 *
 * 用途：让"虚拟 layout"（如 `tree` 派发器）和它的具体实现（mrtree / layered）
 * 共享 pinned position / 图谱级参数 atom 的读取范围。用户在画板上切边样式
 * 时，pinned 不丢失。
 *
 * 同时承担"向后兼容旧 atom"的角色：B4.1 之前写过 layout_id='tree-hierarchy'
 * 的 atom，新版本应仍然认它们。
 *
 * 无依赖文件 — 避免循环 import（elk-adapter / readPinnedPosition 依赖本文件，
 * 而 tree-dispatch 又依赖 elk-adapter）。
 */

/** "tree 家族"：用户视角同一个"层级树"，内部派发到不同算法。 */
export const TREE_FAMILY = new Set(['tree', 'tree-hierarchy', 'tree-layered']);

/**
 * 判断 atom 的 layout_id 是否应被给定 currentLayoutId 消费。
 *
 * 规则：
 *   1. atomLayoutId === '*'                      → 总是消费（跨布局通用）
 *   2. atomLayoutId === currentLayoutId          → 消费（同 layout）
 *   3. 两者都属于 tree 家族                       → 消费（家族共享）
 *   4. 其他                                      → 跳过
 */
export function isInLayoutFamily(atomLayoutId: string, currentLayoutId: string | undefined): boolean {
  if (atomLayoutId === '*') return true;
  if (!currentLayoutId) return false;
  if (atomLayoutId === currentLayoutId) return true;
  if (TREE_FAMILY.has(atomLayoutId) && TREE_FAMILY.has(currentLayoutId)) return true;
  return false;
}
