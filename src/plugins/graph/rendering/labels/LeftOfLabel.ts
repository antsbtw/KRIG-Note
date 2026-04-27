import * as THREE from 'three';
import type { LabelLayout, LabelLayoutInput, LabelLayoutOutput } from './types';

/**
 * left-of — label 在 shape 左侧。
 *
 * 适用：注释式标签 / 时间轴节点（时间在左）。
 *
 * margin = shape 左边到 label 右边的距离。
 */
export const LeftOfLabel: LabelLayout = {
  id: 'left-of',
  defaultMargin: 12,
  compute({ shapeBounds, labelBounds, margin }: LabelLayoutInput): LabelLayoutOutput {
    const m = margin ?? this.defaultMargin;
    const cy = (shapeBounds.min.y + shapeBounds.max.y) / 2;
    const labelHalfW = (labelBounds.max.x - labelBounds.min.x) / 2;
    // shape 左边 - margin - labelHalfW = label 中心 X
    const cx = shapeBounds.min.x - m - labelHalfW;
    return { anchor: new THREE.Vector3(cx, cy, 0.1) };
  },
};
