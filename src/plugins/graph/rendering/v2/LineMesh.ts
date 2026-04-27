/**
 * LineMesh — 创建 Line 几何体的 Three.js Line2 / Line。
 *
 * v1 简化：直线连接两个端点，按 visual.border 设颜色 / 粗细 / 虚线。
 * 多端点折线 + 弧线偏移 v1.5+ 处理。
 */
import * as THREE from 'three';
import type { RenderableGeometry, ResolvedVisual } from './types';

/** 创建 Line 几何体。需要传入 members 节点位置（来自 PointMesh group.position）。 */
export function createLineMesh(
  item: RenderableGeometry,
  memberPositions: Array<{ x: number; y: number; z?: number }>,
): THREE.Object3D | null {
  if (memberPositions.length < 2) return null;

  // v1：直线（首尾两端点）
  const start = memberPositions[0];
  const end = memberPositions[memberPositions.length - 1];

  const points: THREE.Vector3[] = [
    new THREE.Vector3(start.x, start.y, start.z ?? -0.5),
    new THREE.Vector3(end.x, end.y, end.z ?? -0.5),
  ];

  const geometry = new THREE.BufferGeometry().setFromPoints(points);

  const material = createLineMaterial(item.visual);
  const line = material.dashStyle
    ? new THREE.Line(geometry, material.material)
    : new THREE.Line(geometry, material.material);

  // 虚线/点划线需要计算 lineDistances
  if (material.dashStyle) {
    line.computeLineDistances();
  }

  line.userData.id = item.geometry.id;
  line.userData.kind = 'line';
  return line;
}

interface LineMaterialResult {
  material: THREE.LineBasicMaterial | THREE.LineDashedMaterial;
  dashStyle: boolean;
}

function createLineMaterial(visual: ResolvedVisual): LineMaterialResult {
  const color = new THREE.Color(visual.border.color);
  const lineWidth = visual.border.width;  // 注意：WebGL line width 在大多数浏览器只支持 1.0

  if (visual.border.style === 'dashed') {
    return {
      material: new THREE.LineDashedMaterial({
        color,
        linewidth: lineWidth,
        dashSize: 6,
        gapSize: 4,
      }),
      dashStyle: true,
    };
  }
  if (visual.border.style === 'dotted') {
    return {
      material: new THREE.LineDashedMaterial({
        color,
        linewidth: lineWidth,
        dashSize: 2,
        gapSize: 3,
      }),
      dashStyle: true,
    };
  }
  return {
    material: new THREE.LineBasicMaterial({ color, linewidth: lineWidth }),
    dashStyle: false,
  };
}

export function disposeLineMesh(line: THREE.Object3D): void {
  if (line instanceof THREE.Line) {
    line.geometry.dispose();
    if (line.material instanceof THREE.Material) line.material.dispose();
  }
}
