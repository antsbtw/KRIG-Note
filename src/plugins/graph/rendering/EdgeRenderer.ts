import * as THREE from 'three';
import type { ContentRenderer, HighlightMode } from './interfaces';
import type { Atom } from '../engines/GraphEngine';

const EDGE_COLOR_DEFAULT = 0x888888;
const EDGE_COLOR_HOVER = 0xffaa3b;
const EDGE_COLOR_SELECTED = 0x55cc88;
const EDGE_LABEL_SCALE = 0.85;

const EDGE_CURVE_SPACING = 28;
const BEZIER_SEGMENTS = 24;
const ARROW_SIZE = 10;

export interface EdgeRendererOptions {
  source: THREE.Vector3;
  target: THREE.Vector3;
  /** 节点半径，用于端点退避（不穿入节点圆） */
  nodeRadius: number;
  /** bundle 内边索引（多重图弧线偏移用） */
  edgeIndex?: number;
  /** bundle 内总边数 */
  totalEdges?: number;
  /** 是否画箭头 */
  arrow?: boolean;
  /** 边 label（Atom[]） */
  label?: Atom[];
}

/**
 * EdgeRenderer：边的渲染抽象（v1.3 § 3.4 / § 9）。
 *
 * 输出 group 结构：
 *   group.children[0] = 主曲线 Line (THREE.Line, 直线 / 二次贝塞尔)
 *   group.children[1] = 箭头 Mesh（可选）
 *   group.children[2] = label Object3D（可选，由 ContentRenderer 创建）
 *
 * 不持有 edges 数组状态，由 GraphEngine 负责 bundle 计算。
 */
export class EdgeRenderer {
  constructor(private content: ContentRenderer) {}

  async createEdge(opts: EdgeRendererOptions): Promise<THREE.Group> {
    const group = new THREE.Group();

    const geometry = this.computeEdgeGeometry(opts);
    if (!geometry) return group;

    // 主曲线
    const lineGeo = new THREE.BufferGeometry().setFromPoints(geometry.points);
    const lineMat = new THREE.LineBasicMaterial({ color: EDGE_COLOR_DEFAULT });
    const line = new THREE.Line(lineGeo, lineMat);
    group.add(line);

    // 箭头
    if (opts.arrow !== false) {
      const arrow = this.createArrow(geometry.endX, geometry.endY, geometry.arrowAngle);
      group.add(arrow);
    } else {
      // 占位，保持 children 索引稳定
      group.add(new THREE.Group());
    }

    // label
    if (opts.label && opts.label.length > 0 && extractText(opts.label) !== '') {
      const labelObj = await this.content.render(opts.label);
      labelObj.scale.multiplyScalar(EDGE_LABEL_SCALE);
      // 居中对齐：先放原点测 bbox，再让 (labelX, labelY) 落在 bbox 中心
      labelObj.position.set(0, 0, 0.5);
      const bbox = this.content.getBBox(labelObj);
      const cx = (bbox.min.x + bbox.max.x) / 2;
      const cy = (bbox.min.y + bbox.max.y) / 2;
      labelObj.position.set(geometry.labelX - cx, geometry.labelY - cy, 0.5);
      group.add(labelObj);
    }

    return group;
  }

  /** 重新计算端点位置（节点拖动时用）：拆掉重画 */
  async updateEndpoints(group: THREE.Group, opts: EdgeRendererOptions): Promise<void> {
    // 简化做法：保留 label 内容，拆掉重画
    const labelObj = group.children[2];
    const oldLabel = labelObj && labelObj.children.length > 0 ? opts.label : undefined;
    this.dispose(group);
    const fresh = await this.createEdge({ ...opts, label: oldLabel });
    // 把 fresh 的 children 移到 group 上
    while (fresh.children.length > 0) {
      group.add(fresh.children[0]);
    }
  }

  async updateLabel(group: THREE.Group, atoms: Atom[]): Promise<void> {
    // 删除老 label（children[2]），加新的
    const old = group.children[2];
    if (old) {
      group.remove(old);
      this.content.dispose(old);
    }

    if (atoms && atoms.length > 0 && extractText(atoms) !== '') {
      const labelObj = await this.content.render(atoms);
      labelObj.scale.multiplyScalar(EDGE_LABEL_SCALE);
      // label 位置由调用方设置（保持 transform 跟主曲线一致）
      group.add(labelObj);
    }
  }

  setHighlight(group: THREE.Group, mode: HighlightMode): void {
    let color: number;
    switch (mode) {
      case 'hover':    color = EDGE_COLOR_HOVER; break;
      case 'selected': color = EDGE_COLOR_SELECTED; break;
      default:         color = EDGE_COLOR_DEFAULT;
    }
    // children[0] = 主曲线 Line; children[1] = 箭头 Mesh（或占位 Group）
    const line = group.children[0];
    if (line instanceof THREE.Line) {
      (line.material as THREE.LineBasicMaterial).color.setHex(color);
    }
    const arrow = group.children[1];
    if (arrow instanceof THREE.Mesh) {
      (arrow.material as THREE.MeshBasicMaterial).color.setHex(color);
    }
  }

  dispose(group: THREE.Group): void {
    const line = group.children[0];
    if (line instanceof THREE.Line) {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    const arrow = group.children[1];
    if (arrow instanceof THREE.Mesh) {
      arrow.geometry.dispose();
      (arrow.material as THREE.Material).dispose();
    }
    const label = group.children[2];
    if (label) this.content.dispose(label);
    group.children.length = 0;
  }

  // ── 内部：几何计算 ──

  private computeEdgeGeometry(opts: EdgeRendererOptions): {
    points: THREE.Vector3[];
    endX: number;
    endY: number;
    arrowAngle: number;
    labelX: number;
    labelY: number;
  } | null {
    const { source: from, target: to, nodeRadius } = opts;
    const totalEdges = opts.totalEdges ?? 1;
    const edgeIndex = opts.edgeIndex ?? 0;

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return null;

    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;

    const startX = from.x + ux * nodeRadius;
    const startY = from.y + uy * nodeRadius;
    const endX = to.x - ux * nodeRadius;
    const endY = to.y - uy * nodeRadius;

    const offsetFactor = curveOffsetFactor(edgeIndex, totalEdges);
    const offset = offsetFactor * EDGE_CURVE_SPACING;

    if (Math.abs(offset) < 0.01) {
      // 直线
      return {
        points: [new THREE.Vector3(startX, startY, -1), new THREE.Vector3(endX, endY, -1)],
        endX,
        endY,
        arrowAngle: Math.atan2(dy, dx),
        labelX: (startX + endX) / 2,
        labelY: (startY + endY) / 2,
      };
    }

    // 二次贝塞尔
    const midX = (startX + endX) / 2;
    const midY = (startY + endY) / 2;
    const ctrlX = midX + nx * offset;
    const ctrlY = midY + ny * offset;

    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= BEZIER_SEGMENTS; i++) {
      const t = i / BEZIER_SEGMENTS;
      const oneMinusT = 1 - t;
      const x = oneMinusT * oneMinusT * startX + 2 * oneMinusT * t * ctrlX + t * t * endX;
      const y = oneMinusT * oneMinusT * startY + 2 * oneMinusT * t * ctrlY + t * t * endY;
      points.push(new THREE.Vector3(x, y, -1));
    }

    return {
      points,
      endX,
      endY,
      arrowAngle: Math.atan2(endY - ctrlY, endX - ctrlX),
      labelX: 0.25 * startX + 0.5 * ctrlX + 0.25 * endX,
      labelY: 0.25 * startY + 0.5 * ctrlY + 0.25 * endY,
    };
  }

  private createArrow(x: number, y: number, angle: number): THREE.Mesh {
    const arrowGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(-ARROW_SIZE, ARROW_SIZE / 2, 0),
      new THREE.Vector3(-ARROW_SIZE, -ARROW_SIZE / 2, 0),
    ]);
    const arrowMat = new THREE.MeshBasicMaterial({ color: EDGE_COLOR_DEFAULT });
    const arrow = new THREE.Mesh(arrowGeo, arrowMat);
    arrow.position.set(x, y, -0.5);
    arrow.rotation.z = angle;
    return arrow;
  }
}

/**
 * 计算第 k 条边（共 N 条）的法向偏移系数。
 * - N=1 → [0]                直线
 * - N=2 → [-0.5, +0.5]        两侧对称
 * - N=3 → [-1, 0, +1]
 * 通用：k - (N-1)/2
 */
function curveOffsetFactor(edgeIndex: number, totalEdges: number): number {
  return edgeIndex - (totalEdges - 1) / 2;
}

/** 简易 atom → text 提取（避免 import GraphEngine 的 extractPlainText 造成循环依赖） */
function extractText(atoms: Atom[]): string {
  const out: string[] = [];
  function walk(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    const n = node as { text?: string; content?: unknown[] };
    if (typeof n.text === 'string') out.push(n.text);
    if (Array.isArray(n.content)) n.content.forEach(walk);
  }
  atoms.forEach(walk);
  return out.join('').trim();
}
