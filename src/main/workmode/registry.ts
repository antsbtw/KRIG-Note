import { WorkModeRegistration } from '../../shared/types';

/**
 * WorkMode 注册表
 *
 * 管理所有已注册的 WorkMode。框架不硬编码任何 WorkMode，
 * 全部由插件通过 register() 声明。
 */
class WorkModeRegistry {
  private modes: Map<string, WorkModeRegistration> = new Map();

  /** 注册一个 WorkMode */
  register(registration: WorkModeRegistration): void {
    if (this.modes.has(registration.id)) {
      console.warn(`WorkMode '${registration.id}' already registered, overwriting.`);
    }
    this.modes.set(registration.id, registration);
  }

  /** 获取一个 WorkMode */
  get(id: string): WorkModeRegistration | undefined {
    return this.modes.get(id);
  }

  /** 获取所有已注册的 WorkMode（按 order 排序） */
  getAll(): WorkModeRegistration[] {
    return Array.from(this.modes.values()).sort((a, b) => a.order - b.order);
  }

  /** 获取默认 WorkMode（order 最小的） */
  getDefault(): WorkModeRegistration | undefined {
    const all = this.getAll();
    return all.length > 0 ? all[0] : undefined;
  }
}

export const workModeRegistry = new WorkModeRegistry();
