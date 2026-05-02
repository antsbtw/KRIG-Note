import type { CommandHandler } from '@shared/ui-primitives';

/**
 * CommandRegistry — 命令注册中心
 *
 * 五大交互组件(ContextMenu / Toolbar / Slash / Handle / FloatingToolbar)
 * 的菜单项 command 字段是字符串,实际函数在此注册。
 *
 * 详见总纲 § 5.5 强约束第 2 条:command 必须字符串引用。
 *
 * v1 仅骨架,具体命令在 02b/03 由 capability + view 注册。
 */
class CommandRegistryImpl {
  private commands = new Map<string, CommandHandler>();

  register(id: string, handler: CommandHandler): void {
    if (this.commands.has(id)) {
      // eslint-disable-next-line no-console
      console.warn('[CommandRegistry] command already registered, overwriting:', id);
    }
    this.commands.set(id, handler);
  }

  unregister(id: string): void {
    this.commands.delete(id);
  }

  get(id: string): CommandHandler | undefined {
    return this.commands.get(id);
  }

  has(id: string): boolean {
    return this.commands.has(id);
  }
}

export const commandRegistry = new CommandRegistryImpl();
