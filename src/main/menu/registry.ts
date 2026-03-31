import { Menu } from 'electron';
import type { MenuRegistration } from '../../shared/menu-types';

/**
 * Application Menu 注册表
 *
 * 全局稳定：所有 Menu 始终显示，不随 WorkMode/Workspace 变化。
 * 菜单项的动态行为只有 enable/disable，不是显示/隐藏。
 * 零硬编码：所有 Menu 和 MenuItem 通过注册机制注入。
 */

class MenuRegistry {
  private menus: MenuRegistration[] = [];

  /** 注册一个 Menu */
  register(registration: MenuRegistration): void {
    this.menus.push(registration);
  }

  /** 构建并应用 Electron Menu（全局稳定，只需在启动时调用一次） */
  rebuild(): void {
    const sortedMenus = [...this.menus].sort((a, b) => a.order - b.order);

    const template: Electron.MenuItemConstructorOptions[] = [];

    // macOS 应用菜单
    if (process.platform === 'darwin') {
      template.push({ role: 'appMenu' });
    }

    for (const menu of sortedMenus) {
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

      template.push({ label: menu.label, submenu });
    }

    const electronMenu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(electronMenu);
  }
}

export const menuRegistry = new MenuRegistry();
