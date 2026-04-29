import { workModeRegistry } from '../../../main/workmode/registry';

/**
 * Graph Plugin — 框架注册(M1 最小版)
 *
 * v1 范围:
 * - 注册 workMode 'graph',让 shell 能开 Canvas view
 * - NavSide / IPC / 持久化在 M1.5 加(+ 新建画板入口、Canvas note 存盘)
 *
 * 详见 docs/graph/canvas/Canvas.md。
 */

export function register(): void {
  workModeRegistry.register({
    id: 'graph',
    viewType: 'graph',
    icon: '🎨',
    label: 'Graph',
    order: 5,
  });
}
