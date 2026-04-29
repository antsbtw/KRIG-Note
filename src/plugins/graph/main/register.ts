import { workModeRegistry } from '../../../main/workmode/registry';
import { navSideRegistry } from '../../../main/navside/registry';
import type { PluginContext } from '../../../shared/plugin-types';
import { registerGraphIpcHandlers } from './ipc-handlers';

/**
 * Graph Plugin — 框架注册
 *
 * 与 ebook 形态对齐:
 * - WorkMode:让 shell 能开 Graph view(viewType: graph)
 * - NavSide:contentType='graph-list' 路由到 GraphPanel(plugins/graph/navside/)
 * - actionBar 双按钮:+ 文件夹 / + 画板(对齐 NoteView 模式)
 * - actionBar 点击通过 'navside:action' CustomEvent 由 GraphPanel 内部处理,
 *   main 端不需要 registerAction(与 ebook 模式一致)
 * - IPC Handlers:GRAPH_* / GRAPH_FOLDER_* 通道(见 ipc-handlers.ts)
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

  // ── NavSide ──
  navSideRegistry.register({
    workModeId: 'graph',
    actionBar: { title: '画板目录', actions: [
      { id: 'create-folder', label: '+ 文件夹' },
      { id: 'create-canvas', label: '+ 画板' },
    ]},
    contentType: 'graph-list',
  });
}
