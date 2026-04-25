import type { ShapeRenderer, ShapeLibrary } from '../interfaces';
import { CircleShape } from './CircleShape';

/**
 * 通用 ShapeLibrary 实现：节点类型 → ShapeRenderer 映射，
 * 未注册类型回退到默认形状。
 *
 * 详见 docs/graph/KRIG_GraphView_Spec_v1.3.md § 10.1。
 */
export class DefaultShapeLibrary implements ShapeLibrary {
  private shapes = new Map<string, ShapeRenderer>();

  constructor(private defaultShape: ShapeRenderer) {}

  getDefaultShape(): ShapeRenderer {
    return this.defaultShape;
  }

  getShape(nodeType: string): ShapeRenderer {
    return this.shapes.get(nodeType) ?? this.defaultShape;
  }

  registerShape(nodeType: string, renderer: ShapeRenderer): void {
    this.shapes.set(nodeType, renderer);
  }
}

/**
 * 图谱默认形状库：concept → CircleShape，其他类型也回退 CircleShape。
 *
 * v1.3 § 10.2。后续可注册 entity → RoundRectShape 等。
 */
export function createKnowledgeShapeLibrary(): ShapeLibrary {
  const lib = new DefaultShapeLibrary(new CircleShape());
  lib.registerShape('concept', new CircleShape());
  return lib;
}
