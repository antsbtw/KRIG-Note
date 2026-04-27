import * as THREE from 'three';
import type { LineShapeRenderer, ShapeVisual, HighlightMode } from '../interfaces';

const DEFAULT_COLOR = '#888888';
const HIGHLIGHT_HOVER = '#ffaa3b';
const HIGHLIGHT_SELECTED = '#55cc88';
const DEFAULT_ARROW_SIZE = 10;

/**
 * 直线段 / 多点折线 shape 渲染器（relation-* 用）。
 *
 * 输出 Group：
 *   children[0]    = line (THREE.Line)，多点折线连续画段
 *   children[1..]  = 0~2 个三角箭头（arrow 控制）
 *
 * 视觉合成：
 *   - color = visual.border.color（fill 忽略）
 *   - width = visual.border.width（注：WebGL 大多数浏览器只支持 1px linewidth）
 *   - style = visual.border.style（solid / dashed / dotted）
 *   - arrow = visual.arrow（none / forward / backward / both）
 *
 * B3.4 多点支持：
 *   - points.length >= 2 时按全部点画连续折线（首末段 + 所有 bendPoints）
 *   - 箭头只在末段：从 points[len-2] 指向 points[len-1]（forward）
 *                    或 points[1] 指向 points[0]（backward）
 *
 * 内容锚点：折线中段中点（label 用，B3.4.5 暂未启用边 label）。
 */
export class LineSegmentShape implements LineShapeRenderer {
  createMesh(points: THREE.Vector3[], visual: ShapeVisual): THREE.Object3D {
    const group = new THREE.Group();
    if (points.length < 2) return group;

    const color = visual.border?.color ?? DEFAULT_COLOR;
    const width = visual.border?.width ?? 1;
    const style = visual.border?.style ?? 'solid';
    const arrow = visual.arrow ?? 'none';
    const arrowSize = visual.arrowSize ?? DEFAULT_ARROW_SIZE;

    const lineStart = points[0];
    const lineEnd = points[points.length - 1];

    // ── 线段（B3.4：多点折线，所有 points 连续画） ──
    const geometry = new THREE.BufferGeometry().setFromPoints(points);

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
    group.add(line);

    // ── 箭头（如有，画在末段方向上） ──
    // 末段方向：倒数第二点 → 末点（forward）；起点方向：第二点 → 起点（backward）
    const lastSegStart = points[points.length - 2];
    const firstSegEnd = points[1];
    if (arrow === 'forward' || arrow === 'both') {
      group.add(buildArrow(lastSegStart, lineEnd, color, arrowSize));
    }
    if (arrow === 'backward' || arrow === 'both') {
      group.add(buildArrow(firstSegEnd, lineStart, color, arrowSize));
    }

    group.userData.shape = 'line';
    return group;
  }

  setHighlight(mesh: THREE.Object3D, mode: HighlightMode): void {
    // mesh 现在是 Group，遍历内部 Line + 箭头一起染色
    const color = (() => {
      switch (mode) {
        case 'hover': return HIGHLIGHT_HOVER;
        case 'selected': return HIGHLIGHT_SELECTED;
        default: return null;
      }
    })();
    mesh.traverse((o) => {
      if (o instanceof THREE.Line) {
        const mat = o.material as THREE.LineBasicMaterial;
        mat.color.set(color ?? (o.userData.defaultColor as string) ?? DEFAULT_COLOR);
      } else if (o instanceof THREE.Mesh && o.userData.role === 'arrow') {
        const mat = o.material as THREE.MeshBasicMaterial;
        mat.color.set(color ?? (o.userData.defaultColor as string) ?? DEFAULT_COLOR);
      }
    });
  }

  dispose(mesh: THREE.Object3D): void {
    mesh.traverse((o) => {
      if (o instanceof THREE.Line || o instanceof THREE.Mesh) {
        o.geometry.dispose();
        if (o.material instanceof THREE.Material) o.material.dispose();
      }
    });
  }
}

/**
 * 在 toPt 处构造一个指向 toPt 的三角箭头（朝向 = from→to 方向）。
 *
 * 三角形顶点（局部坐标）：
 *   tip = (0, 0)
 *   left = (-size, size/2)
 *   right = (-size, -size/2)
 * 然后旋转到 from→to 的角度，平移到 toPt。
 */
function buildArrow(
  fromPt: THREE.Vector3,
  toPt: THREE.Vector3,
  color: string,
  size: number,
): THREE.Mesh {
  const dx = toPt.x - fromPt.x;
  const dy = toPt.y - fromPt.y;
  const angle = Math.atan2(dy, dx);

  const half = size / 2;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(-size, half);
  shape.lineTo(-size, -half);
  shape.lineTo(0, 0);

  const geometry = new THREE.ShapeGeometry(shape);
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    side: THREE.DoubleSide,
  });
  const arrowMesh = new THREE.Mesh(geometry, material);
  arrowMesh.position.set(toPt.x, toPt.y, toPt.z);
  arrowMesh.rotation.z = angle;
  arrowMesh.userData.role = 'arrow';
  arrowMesh.userData.defaultColor = color;
  return arrowMesh;
}
