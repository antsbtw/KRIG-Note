import { ipcMain } from 'electron';
import { IPC } from '../../../shared/types';
import type { PluginContext } from '../../../shared/plugin-types';
import { workspaceManager } from '../../../main/workspace/manager';
import { graphViewStore } from '../../../main/storage/graphview-store';
import { activityStore } from '../../../main/storage/activity-store';
import { isDBReady } from '../../../main/storage/client';
import type { GraphVariant, GraphNodeRecord, GraphEdgeRecord } from '../../../main/storage/types';

export function registerGraphIpcHandlers(ctx: PluginContext): void {
  const getMainWindow = ctx.getMainWindow;

  function broadcastList(): void {
    const win = getMainWindow();
    if (!win) return;
    graphViewStore.list().then((list) => {
      for (const view of win.contentView.children) {
        if ('webContents' in view) {
          (view as any).webContents.send(IPC.GRAPH_LIST_CHANGED, list);
        }
      }
    }).catch((err) => {
      console.warn('[Graph IPC] Failed to broadcast graph list:', err);
    });
  }

  function broadcastActiveChanged(graphId: string | null): void {
    const win = getMainWindow();
    if (!win) return;
    for (const view of win.contentView.children) {
      if ('webContents' in view) {
        (view as any).webContents.send(IPC.GRAPH_ACTIVE_CHANGED, graphId);
      }
    }
  }

  ipcMain.handle(IPC.GRAPH_CREATE, async (_event, title?: string, hostNoteId?: string | null, variant?: GraphVariant) => {
    if (!isDBReady()) return null;
    const record = await graphViewStore.create(title, hostNoteId ?? null, variant);
    activityStore.log('graph.create', record.id);

    // 自动激活新建的图
    const active = workspaceManager.getActive();
    if (active) workspaceManager.update(active.id, { activeGraphId: record.id });

    broadcastList();
    broadcastActiveChanged(record.id);
    return record;
  });

  ipcMain.handle(IPC.GRAPH_LIST, async () => {
    if (!isDBReady()) return [];
    return graphViewStore.list();
  });

  ipcMain.handle(IPC.GRAPH_LOAD, async (_event, id: string) => {
    if (!isDBReady()) return null;
    return graphViewStore.get(id);
  });

  ipcMain.handle(IPC.GRAPH_RENAME, async (_event, id: string, title: string) => {
    if (!isDBReady()) return;
    await graphViewStore.rename(id, title);
    broadcastList();
  });

  ipcMain.handle(IPC.GRAPH_DELETE, async (_event, id: string) => {
    if (!isDBReady()) return;
    await graphViewStore.delete(id);
    activityStore.log('graph.delete', id);

    // 若被删的图正是当前 workspace 的 active，清掉并广播
    const active = workspaceManager.getActive();
    let activeChanged = false;
    for (const ws of workspaceManager.getAll()) {
      if (ws.activeGraphId === id) {
        workspaceManager.update(ws.id, { activeGraphId: null });
        if (active && ws.id === active.id) activeChanged = true;
      }
    }

    broadcastList();
    if (activeChanged) broadcastActiveChanged(null);
  });

  ipcMain.handle(IPC.GRAPH_SET_ACTIVE, (_event, graphId: string | null) => {
    const active = workspaceManager.getActive();
    if (!active) return;
    workspaceManager.update(active.id, { activeGraphId: graphId });
    broadcastActiveChanged(graphId);
  });

  // ── 节点/边 CRUD ──

  ipcMain.handle(IPC.GRAPH_LOAD_DATA, async (_event, graphId: string) => {
    if (!isDBReady()) return { nodes: [], edges: [] };
    return graphViewStore.loadGraphData(graphId);
  });

  ipcMain.handle(IPC.GRAPH_NODE_SAVE, async (_event, node: GraphNodeRecord) => {
    if (!isDBReady()) return;
    await graphViewStore.saveNode(node);
  });

  ipcMain.handle(IPC.GRAPH_NODE_DELETE, async (_event, graphId: string, nodeId: string) => {
    if (!isDBReady()) return;
    await graphViewStore.deleteNode(graphId, nodeId);
  });

  ipcMain.handle(IPC.GRAPH_EDGE_SAVE, async (_event, edge: GraphEdgeRecord) => {
    if (!isDBReady()) return;
    await graphViewStore.saveEdge(edge);
  });

  ipcMain.handle(IPC.GRAPH_EDGE_DELETE, async (_event, graphId: string, edgeId: string) => {
    if (!isDBReady()) return;
    await graphViewStore.deleteEdge(graphId, edgeId);
  });
}
