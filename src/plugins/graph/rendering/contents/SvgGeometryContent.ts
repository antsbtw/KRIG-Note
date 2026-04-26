import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import type { ContentRenderer } from '../interfaces';
import { atomsToSvg, type Atom } from '../../../../lib/atom-serializers/svg';
import { extractPlainText } from '../../engines/GraphEngine';

const DEFAULT_FILL = 0xdddddd;

/**
 * 默认内容渲染器：Atom[] → SVG → ShapeGeometry → Mesh。
 *
 * 详见 docs/graph/Graph-3D-Rendering-Spec.md § 3.2 / § 5。
 *
 * 错误处理：序列化器 reject 时回退到纯文字提取（extractPlainText）作为
 * fallback path，避免节点显示空白。fallback path 是简单矩形占位。
 */
export class SvgGeometryContent implements ContentRenderer {
  private loader = new SVGLoader();

  async render(atoms: Atom[]): Promise<THREE.Object3D> {
    let svgString: string;
    try {
      svgString = await atomsToSvg(atoms);
    } catch (e) {
      console.warn('[SvgGeometryContent] atomsToSvg failed, falling back', e);
      svgString = this.fallbackSvg(atoms);
    }

    const data = this.loader.parse(svgString);
    const group = new THREE.Group();

    for (const path of data.paths) {
      const fillColor = path.userData?.style?.fill;
      // 显式 fill="none" 跳过（描边类，PoC 暂不处理）
      if (fillColor === 'none') continue;

      const color =
        fillColor && fillColor !== 'currentColor'
          ? new THREE.Color().setStyle(fillColor)
          : new THREE.Color(DEFAULT_FILL);

      const material = new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      const shapes = SVGLoader.createShapes(path);
      for (const shape of shapes) {
        const geometry = new THREE.ShapeGeometry(shape);
        const mesh = new THREE.Mesh(geometry, material);
        group.add(mesh);
      }
    }

    // SVG y 轴向下，Three.js y 轴向上：翻转
    group.scale.y = -1;
    return group;
  }

  getBBox(rendered: THREE.Object3D): THREE.Box3 {
    return new THREE.Box3().setFromObject(rendered);
  }

  dispose(rendered: THREE.Object3D): void {
    rendered.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (obj.material instanceof THREE.Material) obj.material.dispose();
      }
    });
  }

  /** 序列化器失败时的兜底：用纯文字提取生成简单 SVG */
  private fallbackSvg(atoms: Atom[]): string {
    const text = extractPlainText(atoms) || '...';
    const w = Math.max(text.length * 8, 20);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 20" width="${w}" height="20"><path d="M 0 4 h ${w} v 12 h -${w} Z" fill="#cccccc" /></svg>`;
  }
}
