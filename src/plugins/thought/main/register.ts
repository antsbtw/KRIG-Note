import { workModeRegistry } from '../../../main/workmode/registry';

/**
 * Thought Plugin — 框架注册
 *
 * ThoughtView 仅作为 Right Slot，不在 NavSide 中显示。
 */

export function register(): void {
  workModeRegistry.register({
    id: 'thought',
    viewType: 'thought',
    icon: '💭',
    label: 'Thought',
    order: 10,
    hidden: true,
  });
}
