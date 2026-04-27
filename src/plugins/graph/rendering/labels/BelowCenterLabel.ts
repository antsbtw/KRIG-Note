import * as THREE from 'three';
import type { LabelLayout, LabelLayoutInput, LabelLayoutOutput } from './types';

/**
 * below-center — label 在 shape 正下方。
 *
 * 适用：圆形节点 / Line 关系标签 / 一般标注。
 *
 * margin = shape 底边到 label 顶边的距离。
 */
export const BelowCenterLabel: LabelLayout = {
  id: 'below-center',
  defaultMargin: 12,
  compute({ shapeBounds, labelBounds, margin }: LabelLayoutInput): LabelLayoutOutput {
    const m = margin ?? this.defaultMargin;
    const cx = (shapeBounds.min.x + shapeBounds.max.x) / 2;
    const labelHalfH = (labelBounds.max.y - labelBounds.min.y) / 2;
    // shape 底部 - margin - labelHalfH = label 中心 Y（注意 Y 向下为负）
    const cy = shapeBounds.min.y - m - labelHalfH;
    return { anchor: new THREE.Vector3(cx, cy, 0.1) };
  },
};
