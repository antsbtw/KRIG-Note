/**
 * Projection 注册表 — 与 layoutRegistry / viewModeRegistry 同构。
 */
import type { Projection } from './types';

class ProjectionRegistry {
  private store = new Map<string, Projection>();

  register(p: Projection): void {
    this.store.set(p.id, p);
  }

  get(id: string): Projection | undefined {
    return this.store.get(id);
  }

  list(): Projection[] {
    return Array.from(this.store.values());
  }

  has(id: string): boolean {
    return this.store.has(id);
  }
}

export const projectionRegistry = new ProjectionRegistry();
