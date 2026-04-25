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
      if (!fillColor || fillColor === 'none') continue;

      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setStyle(fillColor),
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
