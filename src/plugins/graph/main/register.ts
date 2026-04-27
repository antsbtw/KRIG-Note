import { workModeRegistry } from '../../../main/workmode/registry';
import { navSideRegistry } from '../../../main/navside/registry';
import type { PluginContext } from '../../../shared/plugin-types';
import { graphViewStore } from '../../../main/storage/graphview-store';
import { activityStore } from '../../../main/storage/activity-store';
import { IPC } from '../../../shared/types';
import { registerGraphIpcHandlers } from './ipc-handlers';

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
        { id: 'import-graph', label: '+ 导入' },
      ],
    },
    contentType: 'graph-list',
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
