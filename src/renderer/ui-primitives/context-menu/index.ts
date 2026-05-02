import type { ContextMenuItem } from '@shared/ui-primitives';

/**
 * ContextMenuRegistry — 右键菜单注册中心
 *
 * v1 骨架:支持按 viewId 注册菜单项;具体渲染在 02b/03 完成。
 * 详见总纲 § 5.4 数据契约 + § 5.7 五大交互的统一与差异。
 */
class ContextMenuRegistryImpl {
  private itemsByViewId = new Map<string, ContextMenuItem[]>();

  register(viewId: string, items: ContextMenuItem[]): void {
    this.itemsByViewId.set(viewId, items);
  }

  unregister(viewId: string): void {
    this.itemsByViewId.delete(viewId);
  }

  getItems(viewId: string): ContextMenuItem[] {
    return this.itemsByViewId.get(viewId) ?? [];
  }
}

export const contextMenuRegistry = new ContextMenuRegistryImpl();
