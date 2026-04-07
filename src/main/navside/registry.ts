import type { NavSideRegistration } from '../../shared/types';

/**
 * NavSide 内容注册表
 *
 * 管理各 WorkMode 的 NavSide 内容配置（标题、按钮、内容类型）。
 * NavSide renderer 通过 IPC 查询注册信息，按 contentType 路由面板组件。
 *
 * 遵循 workmode.md §四 的注册制设计。
 */
class NavSideRegistry {
  private registrations = new Map<string, NavSideRegistration>();

  register(reg: NavSideRegistration): void {
    this.registrations.set(reg.workModeId, reg);
  }

  get(workModeId: string): NavSideRegistration | undefined {
    return this.registrations.get(workModeId);
  }
}

export const navSideRegistry = new NavSideRegistry();
