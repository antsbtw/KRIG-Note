import { dialog } from 'electron';
import { workModeRegistry } from '../../../main/workmode/registry';
import { navSideRegistry } from '../../../main/navside/registry';
import { menuRegistry } from '../../../main/menu/registry';
import type { PluginContext } from '../../../shared/plugin-types';
import { graphViewStore } from '../../../main/storage/graphview-store';
import { activityStore } from '../../../main/storage/activity-store';
import { isDBReady } from '../../../main/storage/client';
import { IPC } from '../../../shared/types';
import { registerGraphIpcHandlers } from './ipc-handlers';
import { importFromMarkdown } from './import/handler';

const GRAPH_WORKMODE_ID = 'graph';

export function register(ctx: PluginContext): void {
  registerGraphIpcHandlers(ctx);

  workModeRegistry.register({
    id: GRAPH_WORKMODE_ID,
    viewType: 'graph',
    icon: '🕸',
    label: 'Graph',
    order: 7,
  });

  navSideRegistry.register({
    workModeId: GRAPH_WORKMODE_ID,
    actionBar: {
      title: '图谱目录',
      actions: [
        { id: 'create-folder', label: '+ 文件夹' },
        { id: 'create-graph', label: '+ 图谱' },
      ],
    },
    contentType: 'graph-list',
  });

  // ── Application Menu：Graph ──
  menuRegistry.register({
    id: 'graph-menu',
    label: 'Graph',
    order: 15,
    items: [
      {
        id: 'graph-import-markdown',
        label: 'Import Markdown...',
        handler: async () => {
          if (!isDBReady()) return;
          const win = ctx.getMainWindow();
          const result = await dialog.showOpenDialog(win as any, {
            title: '导入 Markdown 图谱',
            filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
            properties: ['openFile'],
          });
          if (result.canceled || result.filePaths.length === 0) return;
          const filePath = result.filePaths[0];
          try {
            const importResult = await importFromMarkdown(filePath);
            activityStore.log('graph.import', importResult.graphId, {
              path: filePath,
              ...importResult.stats,
              warnings: importResult.warnings.length,
            });
            // 广播列表变更（NavSide GraphPanel 监听刷新）
            if (win) {
              const list = await graphViewStore.list();
              for (const view of win.contentView.children) {
                if ('webContents' in view) {
                  (view as any).webContents.send(IPC.GRAPH_LIST_CHANGED, list);
                }
              }
            }
          } catch (err) {
            console.error('[Graph Menu] import failed:', err);
            if (win) {
              await dialog.showMessageBox(win as any, {
                type: 'error',
                title: '导入失败',
                message: String(err),
              });
            }
          }
        },
      },
    ],
  });

  navSideRegistry.registerAction(GRAPH_WORKMODE_ID, 'create-graph', async () => {
    const record = await graphViewStore.create();
    activityStore.log('graph.create', record.id);

    // 广播列表变更（NavSide GraphPanel 监听刷新）
    const win = ctx.getMainWindow();
    if (win) {
      const list = await graphViewStore.list();
      for (const view of win.contentView.children) {
        if ('webContents' in view) {
          (view as any).webContents.send(IPC.GRAPH_LIST_CHANGED, list);
        }
      }
    }

    return { id: record.id, title: record.title };
  });
}
