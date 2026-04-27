/**
 * LabelLayout — Basic Graph 视图层的 label 布局算法。
 *
 * 职责：给定 shape 几何 + label 文字尺寸，算出 label 中心点的世界坐标 anchor。
 *
 * 不渲染 label 文字本身（那是 ContentRenderer / SvgGeometryContent 的事）。
 * 不读 atom（不知道 label 内容来源，只接收尺寸 bbox）。
 *
 * v1 内置 6 种 layout：
 *   inside-center  shape 内部居中
 *   inside-top     shape 内部顶部（卡片样式）
 *   above-center   shape 上方
 *   below-center   shape 下方
 *   left-of        shape 左侧
 *   right-of       shape 右侧
 *
 * 每个 substance 通过 labelLayout 字段引用一个 layout id；
 * 同一 basic shape 可被不同 substance 配不同的 layout。
 */
import type * as THREE from 'three';

export interface LabelLayoutInput {
  /** shape 的世界坐标包围盒（已含 group.position 偏移） */
  shapeBounds: THREE.Box3;
  /** label mesh 自己的本地包围盒（label 自己是多大） */
  labelBounds: THREE.Box3;
  /** shape 边到 label 的距离（substance 可覆盖默认） */
  margin?: number;
}

export interface LabelLayoutOutput {
  /** label 中心点的世界坐标 */
  anchor: THREE.Vector3;
}

export interface LabelLayout {
  id: string;
  /** 默认 margin（shape 边到 label 的距离） */
  defaultMargin: number;
  compute(input: LabelLayoutInput): LabelLayoutOutput;
}
