import { workModeRegistry } from '../../../main/workmode/registry';
import type { PluginContext } from '../../../shared/plugin-types';
import { registerGraphIpcHandlers } from './ipc-handlers';

/**
 * Graph Plugin — 框架注册
 *
 * 与 ebook 形态对齐:
 * - WorkMode 注册:让 shell 能开 Graph view
 * - IPC Handlers 注册:GRAPH_* / GRAPH_FOLDER_* 通道
 * - NavSide 注册(M1.5b.5 加):画板列表 + create-canvas / create-folder actionBar
 *
 * 详见 docs/graph/canvas/Canvas.md。
 */

export function register(ctx: PluginContext): void {
  // ── IPC Handlers ──
  registerGraphIpcHandlers(ctx);

  // ── WorkMode ──
  workModeRegistry.register({
    id: 'graph',
    viewType: 'graph',
    icon: '🎨',
    label: 'Graph',
    order: 5,
  });

  // M1.5b.5 加:
  // - navSideRegistry.register({ workModeId: 'graph', actionBar: [+ 文件夹, + 画板], contentType: 'graph-list', ... })
  // - navSideRegistry.registerAction('graph', 'create-canvas', ...)
  // - navSideRegistry.registerAction('graph', 'create-folder', ...)
}
