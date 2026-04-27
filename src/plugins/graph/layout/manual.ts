/**
 * Manual 布局算法 — 完全由 presentation atom 驱动。
 *
 * 行为：
 *   - 读取每个 Point 的 presentation atom（layout_id='manual' 或 '*'）
 *     找 attribute='position.x' / 'position.y' 的值
 *   - 没有位置记录的节点放在 (0, 0)
 *
 * 用途：
 *   - 用户希望完全手动控制位置
 *   - 兼容传统"画布"心智的图谱（虽然 KRIG 不主推这种）
 */
import { layoutRegistry } from './registry';
import type { LayoutAlgorithm, LayoutInput, LayoutOutput } from './types';

const manual: LayoutAlgorithm = {
  id: 'manual',
  label: 'Manual',
  supportsDimension: [2, 3],
  compute(input: LayoutInput): LayoutOutput {
    const positions = new Map<string, { x: number; y: number; z?: number }>();
    const points = input.geometries.filter((g) => g.kind === 'point');

    // 收集每个 subject 的 position.* atoms（仅 'manual' / '*' layout）
    const subjectPositions = new Map<string, { x?: number; y?: number; z?: number }>();
    for (const p of input.presentations) {
      if (p.layout_id !== 'manual' && p.layout_id !== '*') continue;
      const cur = subjectPositions.get(p.subject_id) ?? {};
      if (p.attribute === 'position.x') cur.x = parseFloat(p.value);
      else if (p.attribute === 'position.y') cur.y = parseFloat(p.value);
      else if (p.attribute === 'position.z') cur.z = parseFloat(p.value);
      subjectPositions.set(p.subject_id, cur);
    }

    for (const point of points) {
      const pos = subjectPositions.get(point.id);
      positions.set(point.id, {
        x: pos?.x ?? 0,
        y: pos?.y ?? 0,
        ...(input.dimension === 3 && pos?.z !== undefined ? { z: pos.z } : {}),
      });
    }
    return { positions };
  },
};

layoutRegistry.register(manual);
