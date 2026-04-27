import * as THREE from 'three';
import type { LabelLayout, LabelLayoutInput, LabelLayoutOutput } from './types';

/**
 * inside-center — label 在 shape 内部居中。
 *
 * 适用：矩形 / 大六边形 / 大圆（label 装得下）。
 *
 * 不使用 margin（label 直接在中心）。label 的 bbox 由 SVG 渲染器决定，
 * substance 应保证 shape 尺寸足够装下 label，否则视觉重叠。
 */
export const InsideCenterLabel: LabelLayout = {
  id: 'inside-center',
  defaultMargin: 0,
  compute({ shapeBounds }: LabelLayoutInput): LabelLayoutOutput {
    const cx = (shapeBounds.min.x + shapeBounds.max.x) / 2;
    const cy = (shapeBounds.min.y + shapeBounds.max.y) / 2;
    return { anchor: new THREE.Vector3(cx, cy, 0.1) };
  },
};
