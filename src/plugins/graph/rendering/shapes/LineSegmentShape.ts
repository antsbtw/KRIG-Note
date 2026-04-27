import * as THREE from 'three';
import type { LineShapeRenderer, ShapeVisual, HighlightMode } from '../interfaces';

const DEFAULT_COLOR = '#888888';
const HIGHLIGHT_HOVER = '#ffaa3b';
const HIGHLIGHT_SELECTED = '#55cc88';

/**
 * 直线段 shape 渲染器（relation-* 用）。
 *
 * v1 简化：连接首尾两端点的直线。多端点折线、弧线偏移、箭头留 v1.5+。
 *
 * 视觉合成：
 *   - color = visual.border.color（fill 忽略）
 *   - width = visual.border.width（注：WebGL 大多数浏览器只支持 1px linewidth）
 *   - style = visual.border.style（solid / dashed / dotted）
 *
 * 内容锚点：线段中点（label 居中显示在线段上）。
 */
export class LineSegmentShape implements LineShapeRenderer {
  createMesh(points: THREE.Vector3[], visual: ShapeVisual): THREE.Object3D {
    if (points.length < 2) {
      // fallback：返回空 group，不崩溃
      return new THREE.Group();
    }

    const color = visual.border?.color ?? DEFAULT_COLOR;
    const width = visual.border?.width ?? 1;
    const style = visual.border?.style ?? 'solid';

    // 直线段（首尾两点）
    const lineStart = points[0];
    const lineEnd = points[points.length - 1];
    const linePoints = [lineStart, lineEnd];

    const geometry = new THREE.BufferGeometry().setFromPoints(linePoints);

    let material: THREE.LineBasicMaterial | THREE.LineDashedMaterial;
    let needsLineDistances = false;

    if (style === 'dashed') {
      material = new THREE.LineDashedMaterial({
        color: new THREE.Color(color),
        linewidth: width,
        dashSize: 6,
        gapSize: 4,
      });
      needsLineDistances = true;
    } else if (style === 'dotted') {
      material = new THREE.LineDashedMaterial({
        color: new THREE.Color(color),
        linewidth: width,
        dashSize: 2,
        gapSize: 3,
      });
      needsLineDistances = true;
    } else {
      material = new THREE.LineBasicMaterial({
        color: new THREE.Color(color),
        linewidth: width,
      });
    }

    const line = new THREE.Line(geometry, material);
    if (needsLineDistances) line.computeLineDistances();

    line.userData.role = 'line';
    line.userData.defaultColor = color;
    line.userData.startX = lineStart.x;
    line.userData.startY = lineStart.y;
    line.userData.endX = lineEnd.x;
    line.userData.endY = lineEnd.y;
    return line;
  }

  getContentAnchor(mesh: THREE.Object3D): THREE.Vector3 {
    // 线段中点（局部坐标系下；调用方需要 worldToLocal 处理）
    // 注：这里返回的是世界坐标（因为 Line 没用 group 平移），调用方放 label 时直接用
    const sx = (mesh.userData.startX as number) ?? 0;
    const sy = (mesh.userData.startY as number) ?? 0;
    const ex = (mesh.userData.endX as number) ?? 0;
    const ey = (mesh.userData.endY as number) ?? 0;
    return new THREE.Vector3((sx + ex) / 2, (sy + ey) / 2, 0.5);
  }

  setHighlight(mesh: THREE.Object3D, mode: HighlightMode): void {
    if (!(mesh instanceof THREE.Line)) return;
    const mat = mesh.material as THREE.LineBasicMaterial;
    switch (mode) {
      case 'hover':    mat.color.set(HIGHLIGHT_HOVER); break;
      case 'selected': mat.color.set(HIGHLIGHT_SELECTED); break;
      default:         mat.color.set((mesh.userData.defaultColor as string) ?? DEFAULT_COLOR);
    }
  }

  dispose(mesh: THREE.Object3D): void {
    if (mesh instanceof THREE.Line) {
      mesh.geometry.dispose();
      if (mesh.material instanceof THREE.Material) mesh.material.dispose();
    }
  }
}
