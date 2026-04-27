/**
 * ViewMode 注册表 — 与 layoutRegistry / projectionRegistry 同构。
 *
 * v1：base + built-in 层（系统硬编码）；
 * v2.x：theme / community / user 层按 origin 顺序覆盖（决议 11，接口预留）
 */
import type { ViewMode } from './types';

class ViewModeRegistry {
  private store = new Map<string, ViewMode>();

  register(viewMode: ViewMode): void {
    this.store.set(viewMode.id, viewMode);
  }

  get(id: string): ViewMode | undefined {
    return this.store.get(id);
  }

  list(): ViewMode[] {
    return Array.from(this.store.values());
  }

  has(id: string): boolean {
    return this.store.has(id);
  }
}

export const viewModeRegistry = new ViewModeRegistry();
