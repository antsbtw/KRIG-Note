import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import type { ContentRenderer, Atom } from '../types';
import { atomsToSvg } from '../../../../lib/atom-serializers/svg';

export class SvgGeometryContent implements ContentRenderer {
  private loader = new SVGLoader();

  async render(atoms: Atom[]): Promise<THREE.Object3D> {
    const svgString = await atomsToSvg(atoms);
    const data = this.loader.parse(svgString);
    const group = new THREE.Group();

    for (const path of data.paths) {
      const fillColor = path.userData?.style?.fill;
      // 跳过显式 fill="none" 的 path（描边类，PoC 暂不处理）
      if (fillColor === 'none') continue;

      const color = fillColor && fillColor !== 'currentColor'
        ? new THREE.Color().setStyle(fillColor)
        : new THREE.Color(0xdddddd); // 默认浅灰，深色背景上可见

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

    // SVG 坐标 y 轴向下，Three.js y 轴向上：翻转
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
}
