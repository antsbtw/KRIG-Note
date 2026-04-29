import { workModeRegistry } from '../../../main/workmode/registry';
import type { PluginContext } from '../../../shared/plugin-types';

/**
 * Graph Plugin — 框架注册(M1 最小版)
 *
 * v1 范围:
 * - 注册 workMode 'graph',让 shell 能开 Canvas view
 * - NavSide / IPC / 持久化在 M1.5b 加(+ 新建画板入口、Canvas note 存盘)
 *
 * 详见 docs/graph/canvas/Canvas.md。
 *
 * 签名对齐其他 plugin(note/ebook/web 都接 PluginContext);M1.5b 接 IPC
 * handlers / Menu 时会用到 ctx.getMainWindow / ctx.runWithProgress 等。
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function register(_ctx: PluginContext): void {
  workModeRegistry.register({
    id: 'graph',
    viewType: 'graph',
    icon: '🎨',
    label: 'Graph',
    order: 5,
  });
  // M1.5b 接 IPC + NavSide:
  // - registerGraphIpcHandlers(_ctx)
  // - navSideRegistry.register({ workModeId: 'graph', ... })
  // - navSideRegistry.registerAction('graph', 'create-canvas', ...)
}
