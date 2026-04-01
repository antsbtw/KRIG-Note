import { Menu } from 'electron';
import type { MenuRegistration } from '../../shared/menu-types';

/**
 * Application Menu 注册表
 *
 * 全局稳定：所有 Menu 始终显示，不随 WorkMode/Workspace 变化。
 */

interface RoleMenuEntry {
  id: string;
  label: string;
  order: number;
  role: string;
}

class MenuRegistry {
  private menus: MenuRegistration[] = [];
  private roleMenus: RoleMenuEntry[] = [];

  /** 注册一个自定义 Menu */
  register(registration: MenuRegistration): void {
    this.menus.push(registration);
  }

  /** 注册一个 Electron role 菜单（如 Edit，系统自动处理快捷键） */
  registerRoleMenu(id: string, label: string, order: number): void {
    this.roleMenus.push({ id, label, order, role: id + 'Menu' });
  }

  /** 构建并应用 Electron Menu */
  rebuild(): void {
    // 合并所有菜单并排序
    type TemplateEntry = { order: number; item: Electron.MenuItemConstructorOptions };
    const entries: TemplateEntry[] = [];

    // Role 菜单（如 editMenu）
    for (const rm of this.roleMenus) {
      entries.push({
        order: rm.order,
        item: { role: rm.role as any },
      });
    }

    // 自定义菜单
    for (const menu of this.menus) {
      const submenu: Electron.MenuItemConstructorOptions[] = menu.items.map((item) => {
        if (item.separator) {
          return { type: 'separator' as const };
        }
        return {
          id: item.id,
          label: item.label,
          accelerator: item.accelerator,
          enabled: item.enabled ?? true,
          click: () => item.handler(),
        };
      });

      entries.push({
        order: menu.order,
        item: { label: menu.label, submenu },
      });
    }

    // 按 order 排序
    entries.sort((a, b) => a.order - b.order);

    const template: Electron.MenuItemConstructorOptions[] = [];

    // macOS 应用菜单
    if (process.platform === 'darwin') {
      template.push({ role: 'appMenu' });
    }

    for (const entry of entries) {
      template.push(entry.item);
    }

    const electronMenu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(electronMenu);
  }
}

export const menuRegistry = new MenuRegistry();
