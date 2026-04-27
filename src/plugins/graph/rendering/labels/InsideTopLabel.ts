import * as THREE from 'three';
import type { LabelLayout, LabelLayoutInput, LabelLayoutOutput } from './types';

/**
 * inside-top — label 在 shape 内部顶部。
 *
 * 适用：卡片样式节点（标题在上，下面留空给详细内容）。
 *
 * margin = shape 顶边到 label 顶边的距离（往内移）。
 */
export const InsideTopLabel: LabelLayout = {
  id: 'inside-top',
  defaultMargin: 6,
  compute({ shapeBounds, labelBounds, margin }: LabelLayoutInput): LabelLayoutOutput {
    const m = margin ?? this.defaultMargin;
    const cx = (shapeBounds.min.x + shapeBounds.max.x) / 2;
    const labelHalfH = (labelBounds.max.y - labelBounds.min.y) / 2;
    // shape 顶部 - margin - labelHalfH = label 中心 Y
    const cy = shapeBounds.max.y - m - labelHalfH;
    return { anchor: new THREE.Vector3(cx, cy, 0.1) };
  },
};
