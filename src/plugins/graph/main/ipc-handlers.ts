import { ipcMain, dialog } from 'electron';
import { IPC } from '../../../shared/types';
import type { PluginContext } from '../../../shared/plugin-types';
import { workspaceManager } from '../../../main/workspace/manager';
import { graphViewStore } from '../../../main/storage/graphview-store';
import { graphGeometryStore } from '../../../main/storage/graph-geometry-store';
import { graphIntensionAtomStore } from '../../../main/storage/graph-intension-atom-store';
import { graphPresentationAtomStore } from '../../../main/storage/graph-presentation-atom-store';
import { graphFolderStore } from '../../../main/storage/graph-folder-store';
import { activityStore } from '../../../main/storage/activity-store';
import { isDBReady } from '../../../main/storage/client';
import type {
  GraphVariant,
  GraphGeometryRecord,
  GraphIntensionAtomRecord,
  GraphPresentationAtomRecord,
} from '../../../main/storage/types';
import { substanceLibrary } from '../substance';
import { importFromMarkdown } from './import/handler';

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

  ipcMain.handle(IPC.GRAPH_CREATE, async (_event, title?: string, hostNoteId?: string | null, variant?: GraphVariant, folderId?: string | null) => {
    if (!isDBReady()) return null;
    const record = await graphViewStore.create(title, hostNoteId ?? null, variant);
    activityStore.log('graph.create', record.id);

    // 把新图放到指定 folder（v1.4 NavSide）
    if (folderId !== undefined && folderId !== null) {
      await graphViewStore.moveToFolder(record.id, folderId);
      record.folder_id = folderId;
    }

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

  ipcMain.handle(IPC.GRAPH_MOVE_TO_FOLDER, async (_event, id: string, folderId: string | null) => {
    if (!isDBReady()) return;
    await graphViewStore.moveToFolder(id, folderId);
    broadcastList();
  });

  // ── Graph Folder CRUD（v1.4 NavSide 重构）──

  function broadcastFolderList(): void {
    const win = getMainWindow();
    if (!win) return;
    graphFolderStore.list().then((list) => {
      for (const view of win.contentView.children) {
        if ('webContents' in view) {
          (view as any).webContents.send(IPC.GRAPH_FOLDER_LIST_CHANGED, list);
        }
      }
    }).catch((err) => {
      console.warn('[Graph IPC] Failed to broadcast graph folder list:', err);
    });
  }

  ipcMain.handle(IPC.GRAPH_FOLDER_LIST, async () => {
    if (!isDBReady()) return [];
    return graphFolderStore.list();
  });

  ipcMain.handle(IPC.GRAPH_FOLDER_CREATE, async (_event, title: string, parentId?: string | null) => {
    if (!isDBReady()) return null;
    const record = await graphFolderStore.create(title, parentId ?? null);
    broadcastFolderList();
    return record;
  });

  ipcMain.handle(IPC.GRAPH_FOLDER_RENAME, async (_event, id: string, title: string) => {
    if (!isDBReady()) return;
    await graphFolderStore.rename(id, title);
    broadcastFolderList();
  });

  ipcMain.handle(IPC.GRAPH_FOLDER_DELETE, async (_event, id: string) => {
    if (!isDBReady()) return;
    await graphFolderStore.delete(id);
    // 子图归到根（store 已处理），需要广播 graph 列表也变了
    broadcastFolderList();
    broadcastList();
  });

  ipcMain.handle(IPC.GRAPH_FOLDER_MOVE, async (_event, id: string, parentId: string | null) => {
    if (!isDBReady()) return;
    await graphFolderStore.move(id, parentId);
    broadcastFolderList();
  });

  // ── v1.4 graph-import：四态数据 IPC ──

  function broadcastPresentationChanged(graphId: string): void {
    const win = getMainWindow();
    if (!win) return;
    for (const view of win.contentView.children) {
      if ('webContents' in view) {
        (view as any).webContents.send(IPC.GRAPH_PRESENTATION_CHANGED, { graphId });
      }
    }
  }

  // 加载图谱全部数据（GraphView 启动用）
  ipcMain.handle(IPC.GRAPH_LOAD_FULL, async (_event, graphId: string) => {
    if (!isDBReady()) return null;
    const graph = await graphViewStore.get(graphId);
    if (!graph) return null;
    // B4.2：加载全部 layout 的 presentation atom，前端按 family 过滤。
    // 旧实现只取 ['*', activeLayout] 对虚拟 layout（如 'tree' 派发到 mrtree/layered）
    // 不友好，且家族成员（tree-hierarchy / tree-layered）的 atom 也需要前端能看到。
    const [geometries, intensions, presentations] = await Promise.all([
      graphGeometryStore.list(graphId),
      graphIntensionAtomStore.list(graphId),
      graphPresentationAtomStore.list(graphId),
    ]);
    return { graph, geometries, intensions, presentations };
  });

  // Graph 主表：切换布局
  ipcMain.handle(IPC.GRAPH_SET_ACTIVE_LAYOUT, async (_event, graphId: string, layoutId: string) => {
    if (!isDBReady()) return;
    await graphViewStore.setActiveLayout(graphId, layoutId);
  });

  // Graph 主表：切换 ViewMode（v1.6 B3）
  ipcMain.handle(IPC.GRAPH_SET_ACTIVE_VIEW_MODE, async (_event, graphId: string, viewModeId: string) => {
    if (!isDBReady()) return;
    await graphViewStore.setActiveViewMode(graphId, viewModeId);
  });

  // Geometry CRUD
  ipcMain.handle(IPC.GRAPH_GEOMETRY_CREATE, async (_event, record: Omit<GraphGeometryRecord, 'created_at'>) => {
    if (!isDBReady()) return null;
    return graphGeometryStore.create(record);
  });

  ipcMain.handle(IPC.GRAPH_GEOMETRY_DELETE, async (_event, id: string) => {
    if (!isDBReady()) return;
    await graphGeometryStore.delete(id);
  });

  // Intension Atom CRUD
  ipcMain.handle(IPC.GRAPH_INTENSION_LIST, async (_event, graphId: string, subjectId?: string) => {
    if (!isDBReady()) return [];
    return graphIntensionAtomStore.list(graphId, subjectId);
  });

  ipcMain.handle(IPC.GRAPH_INTENSION_CREATE, async (_event, record: Omit<GraphIntensionAtomRecord, 'id' | 'created_at'>) => {
    if (!isDBReady()) return null;
    return graphIntensionAtomStore.create(record);
  });

  ipcMain.handle(IPC.GRAPH_INTENSION_UPDATE, async (_event, id: string, fields: Partial<GraphIntensionAtomRecord>) => {
    if (!isDBReady()) return;
    await graphIntensionAtomStore.update(id, fields);
  });

  ipcMain.handle(IPC.GRAPH_INTENSION_DELETE, async (_event, id: string) => {
    if (!isDBReady()) return;
    await graphIntensionAtomStore.delete(id);
  });

  ipcMain.handle(IPC.GRAPH_INTENSION_CREATE_BULK, async (_event, records: Omit<GraphIntensionAtomRecord, 'id' | 'created_at'>[]) => {
    if (!isDBReady()) return;
    await graphIntensionAtomStore.createBulk(records);
  });

  // Presentation Atom CRUD
  ipcMain.handle(IPC.GRAPH_PRESENTATION_LIST, async (_event, graphId: string, layoutIds?: string[]) => {
    if (!isDBReady()) return [];
    return graphPresentationAtomStore.list(graphId, layoutIds);
  });

  ipcMain.handle(IPC.GRAPH_PRESENTATION_SET, async (_event, record: Omit<GraphPresentationAtomRecord, 'id' | 'updated_at'>) => {
    if (!isDBReady()) return;
    await graphPresentationAtomStore.set(record);
    broadcastPresentationChanged(record.graph_id);
  });

  ipcMain.handle(IPC.GRAPH_PRESENTATION_SET_BULK, async (_event, records: Omit<GraphPresentationAtomRecord, 'id' | 'updated_at'>[]) => {
    if (!isDBReady() || records.length === 0) return;
    await graphPresentationAtomStore.setBulk(records);
    broadcastPresentationChanged(records[0].graph_id);
  });

  ipcMain.handle(IPC.GRAPH_PRESENTATION_DELETE, async (
    _event,
    graphId: string, layoutId: string, subjectId: string, attribute: string,
  ) => {
    if (!isDBReady()) return;
    await graphPresentationAtomStore.delete(graphId, layoutId, subjectId, attribute);
    broadcastPresentationChanged(graphId);
  });

  ipcMain.handle(IPC.GRAPH_PRESENTATION_CLEAR_LAYOUT, async (_event, graphId: string, layoutId: string) => {
    if (!isDBReady()) return;
    await graphPresentationAtomStore.clearByLayout(graphId, layoutId);
    broadcastPresentationChanged(graphId);
  });

  // Substance Library 查询（声明式资源，main 进程内可访问，但 GraphView 也需要）
  ipcMain.handle(IPC.GRAPH_SUBSTANCE_LIST, async () => {
    return substanceLibrary.list();
  });

  ipcMain.handle(IPC.GRAPH_SUBSTANCE_GET, async (_event, id: string) => {
    return substanceLibrary.get(id) ?? null;
  });

  // ── 从 Markdown 文件导入图谱 ──
  //
  // 流程：
  //   1. 弹文件对话框选 .md 文件（无路径参数时）/ 直接读传入路径（自动化测试用）
  //   2. parser → handler → 写 4 张表
  //   3. 广播 GRAPH_LIST_CHANGED（NavSide 自动 refetch 列表 + 显示新图）
  //   4. 返回 { graphId, stats, warnings }
  ipcMain.handle(IPC.GRAPH_IMPORT_FROM_FILE, async (_event, providedPath?: string) => {
    if (!isDBReady()) return { error: 'DB not ready' };

    let filePath = providedPath;
    if (!filePath) {
      const win = getMainWindow();
      const result = await dialog.showOpenDialog(win as any, {
        title: '导入 Markdown 图谱',
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
        properties: ['openFile'],
      });
      if (result.canceled || result.filePaths.length === 0) return { canceled: true };
      filePath = result.filePaths[0];
    }

    try {
      const importResult = await importFromMarkdown(filePath);
      activityStore.log('graph.import', importResult.graphId, {
        path: filePath,
        ...importResult.stats,
        warnings: importResult.warnings.length,
      });
      broadcastList();
      return importResult;
    } catch (err) {
      console.error('[Graph IPC] import failed:', err);
      return { error: String(err) };
    }
  });
}
