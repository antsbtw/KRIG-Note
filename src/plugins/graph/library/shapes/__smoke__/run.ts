/**
 * Smoke test for ShapeRegistry + parametric renderer
 *
 * 不接入测试框架,直接 ts-node 风格运行(或临时挂在某个 view 启动里)。
 * 检查:
 * 1. 所有 22 个 shape 都被 bootstrap 收齐
 * 2. id 不重复
 * 3. 每个 shape 在 200x100 尺寸下能渲染出非空 d 字符串
 * 4. d 字符串不含 NaN / Infinity
 * 5. magnets 数值在 [0, w/h] 范围内
 *
 * 使用:在 graph view 启动时或开发面板上调一次,console 输出报告。
 */

import { ShapeRegistry } from '../registry';
import { renderParametric } from '../renderers';
import type { ParametricOutput } from '../renderers';
import type { ShapeDef } from '../../types';

export interface SmokeReport {
  ok: boolean;
  total: number;
  failed: Array<{ id: string; reason: string }>;
  byCategory: Record<string, number>;
}

const TEST_W = 200;
const TEST_H = 100;

export function runShapeSmoke(): SmokeReport {
  ShapeRegistry.bootstrap();
  const all = ShapeRegistry.list();
  const failed: SmokeReport['failed'] = [];
  const byCategory: Record<string, number> = {};
  const seenIds = new Set<string>();

  for (const shape of all) {
    byCategory[shape.category] = (byCategory[shape.category] ?? 0) + 1;
    if (seenIds.has(shape.id)) {
      failed.push({ id: shape.id, reason: 'duplicate id' });
      continue;
    }
    seenIds.add(shape.id);

    const reason = checkShape(shape);
    if (reason) failed.push({ id: shape.id, reason });
  }

  return {
    ok: failed.length === 0,
    total: all.length,
    failed,
    byCategory,
  };
}

function checkShape(shape: ShapeDef): string | null {
  // text label 走 static-svg 不参与几何渲染,跳过 path 检查
  if (shape.renderer === 'static-svg') return null;
  if (shape.renderer === 'custom') return null;

  let out: ParametricOutput;
  try {
    const r = renderParametric(shape, { width: TEST_W, height: TEST_H });
    out = r.data as ParametricOutput;
  } catch (e) {
    return `render threw: ${(e as Error).message}`;
  }

  if (!out.d || out.d.length === 0) return 'empty path d';
  if (/NaN|Infinity/.test(out.d)) return `path contains NaN/Infinity: "${out.d}"`;

  for (const m of out.magnets) {
    if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) {
      return `magnet ${m.id} not finite: (${m.x},${m.y})`;
    }
  }
  if (out.textBox) {
    const { l, t, r, b } = out.textBox;
    if (![l, t, r, b].every(Number.isFinite)) {
      return `textBox not finite: ${JSON.stringify(out.textBox)}`;
    }
  }
  return null;
}

/** 控制台友好打印 */
export function printSmoke(rep: SmokeReport): void {
  // eslint-disable-next-line no-console
  console.log('[shape-smoke]', rep.ok ? 'OK' : 'FAIL', `total=${rep.total}`);
  // eslint-disable-next-line no-console
  console.log('[shape-smoke] by category:', rep.byCategory);
  if (rep.failed.length) {
    // eslint-disable-next-line no-console
    console.error('[shape-smoke] failures:', rep.failed);
  }
}
