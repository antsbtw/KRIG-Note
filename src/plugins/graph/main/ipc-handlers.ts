import { ipcMain, webContents } from 'electron';
import { IPC } from '../../../shared/types';
import type { PluginContext } from '../../../shared/plugin-types';
import { graphStore, graphFolderStore } from '../../../main/storage/graph-store';
import { activityStore } from '../../../main/storage/activity-store';
import { isDBReady } from '../../../main/storage/client';
import { workspaceManager } from '../../../main/workspace/manager';
import { broadcastWorkspaceState } from '../../../main/ipc/handlers';
import type { GraphVariant } from '../../../shared/types/graph-types';

/**
 * Graph Plugin — IPC Handlers
 *
 * 处理所有 GRAPH_* / GRAPH_FOLDER_* IPC 通道。与 ebook 形态对齐:
 * 独立 IPC namespace、独立 store、独立列表广播。
 *
 * 待打开 graphId(NavSide create-canvas 后,CanvasView ready 时拉取),与
 * note pendingNoteId 对齐。
 */

let pendingGraphId: string | null = null;

export function setPendingGraphId(graphId: string): void {
  pendingGraphId = graphId;
}

export function registerGraphIpcHandlers(ctx: PluginContext): void {
  const getMainWindow = ctx.getMainWindow;

  // ── 广播辅助 ──
  function broadcastGraphList(): void {
    const win = getMainWindow();
    if (!win) return;
    graphStore.list().then((list) => {
      for (const view of win.contentView.children) {
        if ('webContents' in view) {
          (view as { webContents: Electron.WebContents }).webContents.send(IPC.GRAPH_LIST_CHANGED, list);
        }
      }
    }).catch((err) => {
      console.warn('[Graph IPC] Failed to broadcast graph list:', err);
    });
  }

  function broadcastToAll(channel: string, ...args: unknown[]): void {
    const win = getMainWindow();
    if (!win) return;
    for (const child of win.contentView.children) {
      if ('webContents' in child) {
        (child as { webContents: Electron.WebContents }).webContents.send(channel, ...args);
      }
    }
  }

  // ── CanvasView ready 后拉取待打开的 graphId ──
  ipcMain.handle(IPC.GRAPH_PENDING_OPEN, () => {
    const id = pendingGraphId;
    pendingGraphId = null;
    return id;
  });

  // ── Graph CRUD ──
  ipcMain.handle(IPC.GRAPH_CREATE, async (_event, title?: string, variant?: string, folderId?: string | null) => {
    if (!isDBReady()) return null;
    const v: GraphVariant = isVariant(variant) ? variant : 'canvas';
    const record = await graphStore.create(title || 'Untitled Canvas', v, folderId ?? null);
    activityStore.log('graph.create', record.id);
    broadcastGraphList();
    return record;
  });

  ipcMain.handle(IPC.GRAPH_LOAD, async (_event, id: string) => {
    if (!isDBReady()) return null;
    activityStore.log('graph.open', id);
    return graphStore.get(id);
  });

  ipcMain.handle(IPC.GRAPH_SAVE, async (_event, id: string, docContent: unknown, title: string) => {
    if (!isDBReady()) return;
    await graphStore.save(id, docContent, title);
    activityStore.log('graph.save', id);
    broadcastGraphList();
  });

  ipcMain.handle(IPC.GRAPH_DELETE, async (_event, id: string) => {
    if (!isDBReady()) return;
    await graphStore.delete(id);
    activityStore.log('graph.delete', id);
    broadcastGraphList();
    broadcastToAll(IPC.GRAPH_DELETED, id);
  });

  ipcMain.handle(IPC.GRAPH_RENAME, async (_event, id: string, title: string) => {
    if (!isDBReady()) return;
    await graphStore.rename(id, title);
    broadcastGraphList();
    broadcastToAll(IPC.GRAPH_TITLE_CHANGED, { graphId: id, title });
  });

  ipcMain.handle(IPC.GRAPH_LIST, async () => {
    if (!isDBReady()) return [];
    return graphStore.list();
  });

  ipcMain.handle(IPC.GRAPH_MOVE_TO_FOLDER, async (_event, id: string, folderId: string | null) => {
    if (!isDBReady()) return;
    await graphStore.moveToFolder(id, folderId);
    broadcastGraphList();
  });

  ipcMain.handle(IPC.GRAPH_DUPLICATE, async (_event, id: string, targetFolderId?: string | null) => {
    if (!isDBReady()) return null;
    const result = await graphStore.duplicate(id, targetFolderId);
    broadcastGraphList();
    return result;
  });

  ipcMain.handle(IPC.GRAPH_OPEN_IN_VIEW, async (event, graphId: string) => {
    // 类比 NOTE_OPEN_IN_EDITOR:按发送者所在 slot 定向发送
    const senderId = event.sender.id;
    const slot = ctx.getSlotBySenderId(senderId);
    if (slot) {
      // CanvasView 内部触发(toolbar Open 按钮)→ 只发回自己
      event.sender.send(IPC.GRAPH_OPEN_IN_VIEW, graphId);
    } else {
      // NavSide 触发 → 发给 left slot
      const { leftId } = ctx.getActiveViewWebContentsIds();
      if (leftId != null) {
        webContents.fromId(leftId)?.send(IPC.GRAPH_OPEN_IN_VIEW, graphId);
      }
    }
  });

  // ── Workspace 状态同步:CanvasView 报告当前打开的画板 ──
  // 用于 app 重启时恢复"上次打开的画板"(类比 SET_ACTIVE_NOTE)
  ipcMain.handle(IPC.GRAPH_SET_ACTIVE, (_event, graphId: string | null) => {
    const active = workspaceManager.getActive();
    if (!active) return;
    workspaceManager.update(active.id, { activeGraphId: graphId });
    // 广播给 NavSide 让它知道当前活跃 graph(高亮 / 同步)
    broadcastWorkspaceState(ctx.getMainWindow());
  });

  // ── Folder CRUD ──
  ipcMain.handle(IPC.GRAPH_FOLDER_CREATE, async (_event, title: string, parentId?: string | null) => {
    if (!isDBReady()) return null;
    const result = await graphFolderStore.create(title, parentId ?? null);
    broadcastGraphList();
    return result;
  });

  ipcMain.handle(IPC.GRAPH_FOLDER_RENAME, async (_event, id: string, title: string) => {
    if (!isDBReady()) return;
    await graphFolderStore.rename(id, title);
    broadcastGraphList();
  });

  ipcMain.handle(IPC.GRAPH_FOLDER_DELETE, async (_event, id: string) => {
    if (!isDBReady()) return;
    await graphFolderStore.delete(id);
    broadcastGraphList();
  });

  ipcMain.handle(IPC.GRAPH_FOLDER_MOVE, async (_event, id: string, parentId: string | null) => {
    if (!isDBReady()) return;
    await graphFolderStore.move(id, parentId);
    broadcastGraphList();
  });

  ipcMain.handle(IPC.GRAPH_FOLDER_LIST, async () => {
    if (!isDBReady()) return [];
    return graphFolderStore.list();
  });
}

function isVariant(raw: unknown): raw is GraphVariant {
  return raw === 'canvas' || raw === 'family-tree' || raw === 'knowledge' || raw === 'mindmap';
}
