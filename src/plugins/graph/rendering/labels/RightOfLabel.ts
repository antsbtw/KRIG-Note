import * as THREE from 'three';
import type { LabelLayout, LabelLayoutInput, LabelLayoutOutput } from './types';

/**
 * right-of — label 在 shape 右侧。
 *
 * 适用：标注 / 法律文档 / 图谱右侧说明。
 *
 * margin = shape 右边到 label 左边的距离。
 */
export const RightOfLabel: LabelLayout = {
  id: 'right-of',
  defaultMargin: 12,
  compute({ shapeBounds, labelBounds, margin }: LabelLayoutInput): LabelLayoutOutput {
    const m = margin ?? this.defaultMargin;
    const cy = (shapeBounds.min.y + shapeBounds.max.y) / 2;
    const labelHalfW = (labelBounds.max.x - labelBounds.min.x) / 2;
    // shape 右边 + margin + labelHalfW = label 中心 X
    const cx = shapeBounds.max.x + m + labelHalfW;
    return { anchor: new THREE.Vector3(cx, cy, 0.1) };
  },
};
