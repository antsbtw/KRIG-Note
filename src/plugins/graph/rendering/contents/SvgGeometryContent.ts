import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import type { ContentRenderer } from '../interfaces';
import { atomsToSvg, type Atom } from '../../../../lib/atom-serializers/svg';
import { extractPlainText } from '../../engines/GraphEngine';
import { LruCache } from '../../../../lib/atom-serializers/lru';

const DEFAULT_FILL = 0xdddddd;

/**
 * L2 GeometryCache 的一条记录：从某个 SVG 字符串解析得到的 path 渲染单元。
 * 每个 unit 对应一个 fill 颜色，含一组共享 geometry + 共享 material。
 *
 * Mesh 不缓存（spec § 5.1 L3）：每次 render 时为每个 unit 创建新 Mesh，
 * 复用 geometry + material 引用。
 */
interface CachedGeometryUnit {
  geometries: THREE.ShapeGeometry[];
  material: THREE.MeshBasicMaterial;
}
type CachedGeometry = CachedGeometryUnit[];

/**
 * 默认内容渲染器：Atom[] → SVG → ShapeGeometry → Mesh。
 *
 * 详见 docs/graph/Graph-3D-Rendering-Spec.md § 3.2 / § 5。
 *
 * 三级缓存（spec § 5.1）：
 * - L1（atomsToSvg 内部）：atoms → SVG 字符串
 * - L2（本类）：SVG 字符串 → ShapeGeometry[] + Material（共享引用）
 * - L3：Mesh 不缓存，每次新建（独立 transform）
 *
 * 错误处理：序列化器 reject 时回退到纯文字提取（extractPlainText）作为
 * fallback path，避免节点显示空白。fallback path 是简单矩形占位。
 */
export class SvgGeometryContent implements ContentRenderer {
  private loader = new SVGLoader();

  /**
   * L2 GeometryCache（spec § 5.1）：SVG 字符串 → 解析后的 path 渲染单元。
   * 静态字段：跨 SvgGeometryContent 实例共享，因为节点 / 边 label 都用同一个
   * SVG 几何路径，缓存命中率最大化。
   */
  private static GEOMETRY_CACHE = new LruCache<string, CachedGeometry>(500);

  static getGeometryCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
    return {
      size: this.GEOMETRY_CACHE.size,
      hits: this.GEOMETRY_CACHE.hits,
      misses: this.GEOMETRY_CACHE.misses,
      hitRate: this.GEOMETRY_CACHE.hitRate(),
    };
  }

  static clearGeometryCache(): void {
    for (const cached of this.GEOMETRY_CACHE.values()) {
      for (const unit of cached) {
        for (const g of unit.geometries) g.dispose();
        unit.material.dispose();
      }
    }
    this.GEOMETRY_CACHE.clear();
  }

  async render(atoms: Atom[]): Promise<THREE.Object3D> {
    let svgString: string;
    try {
      svgString = await atomsToSvg(atoms);
    } catch (e) {
      console.warn('[SvgGeometryContent] atomsToSvg failed, falling back', e);
      svgString = this.fallbackSvg(atoms);
    }

    const cached = this.getOrParseGeometry(svgString);

    // 用缓存的 geometry + material 创建独立 mesh
    const group = new THREE.Group();
    for (const unit of cached) {
      for (const g of unit.geometries) {
        group.add(new THREE.Mesh(g, unit.material));
      }
    }

    // SVG y 轴向下，Three.js y 轴向上：翻转
    group.scale.y = -1;
    return group;
  }

  /** L2 缓存查找 / 回填 */
  private getOrParseGeometry(svgString: string): CachedGeometry {
    const cached = SvgGeometryContent.GEOMETRY_CACHE.get(svgString);
    if (cached) return cached;

    const data = this.loader.parse(svgString);
    const units: CachedGeometryUnit[] = [];

    for (const path of data.paths) {
      const fillColor = path.userData?.style?.fill;
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
      const geometries = shapes.map((shape) => new THREE.ShapeGeometry(shape));
      units.push({ geometries, material });
    }

    SvgGeometryContent.GEOMETRY_CACHE.set(svgString, units);
    return units;
  }

  getBBox(rendered: THREE.Object3D): THREE.Box3 {
    return new THREE.Box3().setFromObject(rendered);
  }

  /**
   * L3 不缓存：dispose 时只移除 mesh 自身，**不 dispose geometry / material**
   * （它们由 L2 缓存共享管理，被 LRU 淘汰时统一 dispose）。
   */
  dispose(rendered: THREE.Object3D): void {
    rendered.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        // 不 dispose geometry/material：它们是 L2 共享资源
        obj.parent?.remove(obj);
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
