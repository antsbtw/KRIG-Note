import { workModeRegistry } from '../../../main/workmode/registry';
import type { registerThoughtIpcHandlers as _ThoughtIpc } from './ipc-handlers';

/**
 * Thought Plugin — 框架注册
 *
 * ThoughtView 仅作为 Right Slot，不在 NavSide 中显示。
 */

export function register(): void {
  // TODO Phase 2: registerThoughtIpcHandlers();
  workModeRegistry.register({
    id: 'thought',
    viewType: 'thought',
    icon: '💭',
    label: 'Thought',
    order: 10,
    hidden: true,
  });
}
