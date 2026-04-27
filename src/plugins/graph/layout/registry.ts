/**
 * 布局算法注册表。
 */
import type { LayoutAlgorithm } from './types';

class LayoutRegistry {
  private store = new Map<string, LayoutAlgorithm>();

  register(algorithm: LayoutAlgorithm): void {
    this.store.set(algorithm.id, algorithm);
  }

  get(id: string): LayoutAlgorithm | undefined {
    return this.store.get(id);
  }

  list(filter?: { dimension?: 2 | 3 }): LayoutAlgorithm[] {
    const all = Array.from(this.store.values());
    if (!filter?.dimension) return all;
    return all.filter((a) => a.supportsDimension.includes(filter.dimension!));
  }
}

export const layoutRegistry = new LayoutRegistry();
