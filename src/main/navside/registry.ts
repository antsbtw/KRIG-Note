import type { NavSideRegistration } from '../../shared/types';

/**
 * NavSide 内容注册表
 *
 * 管理各 WorkMode 的 NavSide 内容配置（标题、按钮、内容类型）。
 * NavSide renderer 通过 IPC 查询注册信息，按 contentType 路由面板组件。
 *
 * 遵循 workmode.md §四 的注册制设计。
 */

type ActionHandler = (params: Record<string, unknown>) => Promise<unknown>;

class NavSideRegistry {
  private registrations = new Map<string, NavSideRegistration>();
  /** workModeId → actionId → handler */
  private actionHandlers = new Map<string, Map<string, ActionHandler>>();

  register(reg: NavSideRegistration): void {
    this.registrations.set(reg.workModeId, reg);
  }

  get(workModeId: string): NavSideRegistration | undefined {
    return this.registrations.get(workModeId);
  }

  /** 插件注册 action handler */
  registerAction(workModeId: string, actionId: string, handler: ActionHandler): void {
    let map = this.actionHandlers.get(workModeId);
    if (!map) {
      map = new Map();
      this.actionHandlers.set(workModeId, map);
    }
    map.set(actionId, handler);
  }

  /** Shell 通过 IPC 执行 action，路由到对应插件 */
  async executeAction(workModeId: string, actionId: string, params: Record<string, unknown>): Promise<unknown> {
    const handler = this.actionHandlers.get(workModeId)?.get(actionId);
    if (!handler) return null;
    return handler(params);
  }
}

export const navSideRegistry = new NavSideRegistry();
