import * as THREE from 'three';
import type { LabelLayout, LabelLayoutInput, LabelLayoutOutput } from './types';

/**
 * above-center — label 在 shape 正上方。
 *
 * 适用：Surface 凸包标题、强调标注。
 *
 * margin = shape 顶边到 label 底边的距离。
 */
export const AboveCenterLabel: LabelLayout = {
  id: 'above-center',
  defaultMargin: 12,
  compute({ shapeBounds, labelBounds, margin }: LabelLayoutInput): LabelLayoutOutput {
    const m = margin ?? this.defaultMargin;
    const cx = (shapeBounds.min.x + shapeBounds.max.x) / 2;
    const labelHalfH = (labelBounds.max.y - labelBounds.min.y) / 2;
    // shape 顶部 + margin + labelHalfH = label 中心 Y
    const cy = shapeBounds.max.y + m + labelHalfH;
    return { anchor: new THREE.Vector3(cx, cy, 0.1) };
  },
};
