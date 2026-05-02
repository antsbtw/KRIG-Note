import type { ToolbarItem } from '@shared/ui-primitives';

/**
 * ToolbarRegistry — 工具栏注册中心
 *
 * v1 骨架:支持按 viewId 注册菜单项;具体渲染在 02b/03 完成。
 * 详见总纲 § 5.4 数据契约 + § 5.7 五大交互的统一与差异。
 */
class ToolbarRegistryImpl {
  private itemsByViewId = new Map<string, ToolbarItem[]>();

  register(viewId: string, items: ToolbarItem[]): void {
    this.itemsByViewId.set(viewId, items);
  }

  unregister(viewId: string): void {
    this.itemsByViewId.delete(viewId);
  }

  getItems(viewId: string): ToolbarItem[] {
    return this.itemsByViewId.get(viewId) ?? [];
  }
}

export const toolbarRegistry = new ToolbarRegistryImpl();
