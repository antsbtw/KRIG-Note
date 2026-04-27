/**
 * Shape 库 — 5 个基础形状渲染器。
 *
 * 按 substance.visual.shape 字段选择对应实现：
 *   - 'circle'        → CircleShape
 *   - 'hexagon'       → HexagonShape
 *   - 'rounded-rect' / 'box' → RoundedRectShape
 *   - 'line'          → LineSegmentShape (LineShapeRenderer)
 *   - 'polygon' / 'convex-hull' → ConvexHullShape (SurfaceShapeRenderer)
 *
 * 注：Point 类（circle / hexagon / rounded-rect）和 Line / Surface 是不同接口。
 * 调用方按几何 kind 选注册表。
 */
import { CircleShape } from './CircleShape';
import { HexagonShape } from './HexagonShape';
import { RoundedRectShape } from './RoundedRectShape';
import { LineSegmentShape } from './LineSegmentShape';
import { ConvexHullShape } from './ConvexHullShape';
import type {
  PointShapeRenderer,
  LineShapeRenderer,
  SurfaceShapeRenderer,
} from '../interfaces';

export { CircleShape, HexagonShape, RoundedRectShape, LineSegmentShape, ConvexHullShape };

// ── Shape 注册表 ──

class PointShapeRegistry {
  private store = new Map<string, PointShapeRenderer>();
  register(id: string, renderer: PointShapeRenderer): void {
    this.store.set(id, renderer);
  }
  get(id: string): PointShapeRenderer {
    return this.store.get(id) ?? this.store.get('circle')!;
  }
  has(id: string): boolean {
    return this.store.has(id);
  }
}

class LineShapeRegistry {
  private store = new Map<string, LineShapeRenderer>();
  register(id: string, renderer: LineShapeRenderer): void {
    this.store.set(id, renderer);
  }
  get(id: string): LineShapeRenderer {
    return this.store.get(id) ?? this.store.get('line')!;
  }
}

class SurfaceShapeRegistry {
  private store = new Map<string, SurfaceShapeRenderer>();
  register(id: string, renderer: SurfaceShapeRenderer): void {
    this.store.set(id, renderer);
  }
  get(id: string): SurfaceShapeRenderer {
    return this.store.get(id) ?? this.store.get('polygon')!;
  }
}

export const pointShapeRegistry = new PointShapeRegistry();
export const lineShapeRegistry = new LineShapeRegistry();
export const surfaceShapeRegistry = new SurfaceShapeRegistry();

// 内置注册（v1）
pointShapeRegistry.register('circle', new CircleShape());
pointShapeRegistry.register('hexagon', new HexagonShape());
pointShapeRegistry.register('rounded-rect', new RoundedRectShape());
pointShapeRegistry.register('box', new RoundedRectShape());  // alias

lineShapeRegistry.register('line', new LineSegmentShape());

surfaceShapeRegistry.register('polygon', new ConvexHullShape());
surfaceShapeRegistry.register('convex-hull', new ConvexHullShape());  // alias
