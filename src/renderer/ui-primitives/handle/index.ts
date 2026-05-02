import type { HandleItem } from '@shared/ui-primitives';

/**
 * HandleRegistry — 块手柄菜单注册中心
 *
 * v1 骨架:支持按 viewId 注册菜单项;具体渲染在 02b/03 完成。
 * 详见总纲 § 5.4 数据契约 + § 5.7 五大交互的统一与差异。
 */
class HandleRegistryImpl {
  private itemsByViewId = new Map<string, HandleItem[]>();

  register(viewId: string, items: HandleItem[]): void {
    this.itemsByViewId.set(viewId, items);
  }

  unregister(viewId: string): void {
    this.itemsByViewId.delete(viewId);
  }

  getItems(viewId: string): HandleItem[] {
    return this.itemsByViewId.get(viewId) ?? [];
  }
}

export const handleRegistry = new HandleRegistryImpl();
