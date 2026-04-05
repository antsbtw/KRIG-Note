import { ipcMain, BaseWindow } from 'electron';
import { IPC, ViewMessage } from '../../shared/types';
import { workspaceManager } from '../workspace/manager';
import { workModeRegistry } from '../workmode/registry';
import {
  updateLayout,
  switchLeftSlotView,
  switchWorkspace,
  closeWorkspaceViews,
  openRightSlot,
  closeRightSlot,
  getActiveViewWebContentsIds,
  getActiveProtocol,
} from '../window/shell';
import { getNavSideWidth, setNavSideWidth } from '../slot/layout';
import { noteStore } from '../storage/note-store';
import { folderStore } from '../storage/folder-store';
import { activityStore } from '../storage/activity-store';
import { isDBReady } from '../storage/client';

export function registerIpcHandlers(getMainWindow: () => BaseWindow | null): void {
  // ── Workspace 操作 ──

  ipcMain.handle(IPC.WORKSPACE_LIST, () => {
    return {
      workspaces: workspaceManager.getAll(),
      activeId: workspaceManager.getActiveId(),
      active: workspaceManager.getActive(),
    };
  });

  ipcMain.handle(IPC.WORKSPACE_CREATE, () => {
    const oldActiveId = workspaceManager.getActiveId();
    const workspace = workspaceManager.create();
    workspaceManager.setActive(workspace.id);
    switchWorkspace(oldActiveId, workspace.id);
    broadcastWorkspaceState(getMainWindow());
    return workspace;
  });

  ipcMain.handle(IPC.WORKSPACE_SWITCH, (_event, id: string) => {
    const oldActiveId = workspaceManager.getActiveId();
    if (oldActiveId === id) return;

    // 保存当前 NavSide 展开状态到旧 Workspace（由 NavSide 通过 broadcastWorkspaceState 间接保存）
    const workspace = workspaceManager.setActive(id);
    if (workspace) {
      switchWorkspace(oldActiveId, id);
      broadcastWorkspaceState(getMainWindow());

      // 通知所有 View 恢复新 Workspace 的状态
      const mainWindow = getMainWindow();
      if (mainWindow) {
        for (const child of mainWindow.contentView.children) {
          if ('webContents' in child) {
            (child as any).webContents.send(IPC.RESTORE_WORKSPACE_STATE, {
              activeNoteId: workspace.activeNoteId,
              expandedFolders: workspace.expandedFolders,
            });
          }
        }
      }
    }
    return workspace;
  });

  ipcMain.handle(IPC.WORKSPACE_CLOSE, (_event, id: string) => {
    closeWorkspaceViews(id);
    const oldActiveId = workspaceManager.getActiveId();
    const newActiveId = workspaceManager.close(id);
    if (newActiveId && newActiveId !== oldActiveId) {
      switchWorkspace(null, newActiveId);
    }
    broadcastWorkspaceState(getMainWindow());
    return newActiveId;
  });

  ipcMain.handle(IPC.WORKSPACE_REORDER, (_event, ids: string[]) => {
    workspaceManager.reorder(ids);
    broadcastWorkspaceState(getMainWindow());
  });

  ipcMain.handle(IPC.WORKSPACE_RENAME, (_event, id: string, label: string) => {
    workspaceManager.rename(id, label);
    // 标记为用户自定义名称（不再自动跟随笔记标题）
    workspaceManager.update(id, { customLabel: true });
    broadcastWorkspaceState(getMainWindow());
  });

  // ── WorkMode 操作 ──

  ipcMain.handle(IPC.WORKMODE_LIST, () => {
    return workModeRegistry.getAll();
  });

  ipcMain.handle(IPC.WORKMODE_SWITCH, (_event, workModeId: string) => {
    const active = workspaceManager.getActive();
    if (!active) return;
    workspaceManager.update(active.id, { workModeId });
    switchLeftSlotView(workModeId);
    broadcastWorkspaceState(getMainWindow());
  });

  // ── Slot 操作 ──

  ipcMain.handle(IPC.SLOT_OPEN_RIGHT, (_event, workModeId: string) => {
    openRightSlot(workModeId);
    broadcastWorkspaceState(getMainWindow());
  });

  ipcMain.handle(IPC.SLOT_CLOSE_RIGHT, () => {
    closeRightSlot();
    broadcastWorkspaceState(getMainWindow());
  });

  // ── View 间消息路由（双工，宽松模式） ──

  ipcMain.on(IPC.VIEW_MESSAGE_SEND, (event, message: ViewMessage) => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return;

    // 协议匹配检查：只有注册了协议的 View 组合才允许通信
    const activeProtocol = getActiveProtocol();
    if (activeProtocol === null) return; // 未匹配 = 不转发

    const { leftId, rightId } = getActiveViewWebContentsIds();
    const senderId = event.sender.id;

    // 路由到"对面"的 View
    let targetId: number | null = null;
    if (senderId === leftId) {
      targetId = rightId;
    } else if (senderId === rightId) {
      targetId = leftId;
    }

    if (targetId === null) return;

    // 在所有 child views 中找到目标并发送
    for (const child of mainWindow.contentView.children) {
      if ('webContents' in child && child.webContents.id === targetId) {
        child.webContents.send(IPC.VIEW_MESSAGE_RECEIVE, message);
        break;
      }
    }
  });

  // ── NavSide 操作 ──

  ipcMain.handle(IPC.NAVSIDE_TOGGLE, () => {
    const active = workspaceManager.getActive();
    if (!active) return;
    workspaceManager.update(active.id, { navSideVisible: !active.navSideVisible });
    broadcastWorkspaceState(getMainWindow());
  });

  // ── NavSide 宽度拖拽 ──

  let navResizeDragging = false;
  let navResizeLastX = 0;

  ipcMain.on(IPC.NAVSIDE_RESIZE_START, (_event, screenX: number) => {
    navResizeDragging = true;
    navResizeLastX = screenX;
  });

  ipcMain.on(IPC.NAVSIDE_RESIZE_MOVE, (_event, screenX: number) => {
    if (!navResizeDragging) return;
    const deltaX = screenX - navResizeLastX;
    navResizeLastX = screenX;
    if (deltaX === 0) return;

    setNavSideWidth(getNavSideWidth() + deltaX);
    updateLayout();
  });

  ipcMain.on(IPC.NAVSIDE_RESIZE_END, () => {
    navResizeDragging = false;
  });

  // ── NoteFile 操作 ──

  ipcMain.handle(IPC.NOTE_CREATE, async (_event, title?: string) => {
    if (!isDBReady()) return null;
    const note = await noteStore.create(title);
    activityStore.log('note.create', note.id);
    broadcastNoteList(getMainWindow());
    return note;
  });

  ipcMain.handle(IPC.NOTE_SAVE, async (_event, id: string, docContent: unknown[], title: string) => {
    if (!isDBReady()) return;
    await noteStore.save(id, docContent, title);
    activityStore.log('note.save', id);
    broadcastNoteList(getMainWindow());
  });

  ipcMain.handle(IPC.NOTE_LOAD, async (_event, id: string) => {
    if (!isDBReady()) return null;
    activityStore.log('note.open', id);
    return noteStore.get(id);
  });

  ipcMain.handle(IPC.NOTE_DELETE, async (_event, id: string) => {
    if (!isDBReady()) return;
    await noteStore.delete(id);
    activityStore.log('note.delete', id);
    broadcastNoteList(getMainWindow());
  });

  ipcMain.handle(IPC.NOTE_RENAME, async (_event, id: string, title: string) => {
    if (!isDBReady()) return;
    await noteStore.rename(id, title);
    broadcastNoteList(getMainWindow());

    // 通知 NoteView 同步 noteTitle（如果该笔记正在编辑器中打开）
    const mainWindow = getMainWindow();
    if (mainWindow) {
      for (const child of mainWindow.contentView.children) {
        if ('webContents' in child) {
          (child as any).webContents.send(IPC.NOTE_TITLE_CHANGED, { noteId: id, title });
        }
      }
    }
  });

  ipcMain.handle(IPC.NOTE_LIST, async () => {
    if (!isDBReady()) return [];
    return noteStore.list();
  });

  // DB 就绪状态查询（防止 renderer 在 db:ready 事件之后加载时错过事件）
  ipcMain.handle(IPC.IS_DB_READY, () => {
    return isDBReady();
  });

  // NoteView 报告当前打开的笔记 → 更新 Workspace 状态 + 自动更新 label
  ipcMain.handle(IPC.SET_ACTIVE_NOTE, (_event, noteId: string | null, noteTitle?: string) => {
    const active = workspaceManager.getActive();
    if (active) {
      const updates: Partial<import('../../shared/types').WorkspaceState> = { activeNoteId: noteId };
      // 自动更新 label（如果不是用户自定义的）
      if (!active.customLabel && noteTitle) {
        updates.label = noteTitle;
      }
      workspaceManager.update(active.id, updates);
      broadcastWorkspaceState(getMainWindow());
    }
  });

  // NavSide 报告展开的文件夹 → 更新 Workspace 状态
  ipcMain.handle(IPC.SET_EXPANDED_FOLDERS, (_event, folderIds: string[]) => {
    const active = workspaceManager.getActive();
    if (active) {
      workspaceManager.update(active.id, { expandedFolders: folderIds });
    }
  });

  // 笔记移动到文件夹
  ipcMain.handle(IPC.NOTE_MOVE_TO_FOLDER, async (_event, noteId: string, folderId: string | null) => {
    if (!isDBReady()) return;
    await noteStore.moveToFolder(noteId, folderId);
    broadcastNoteList(getMainWindow());
  });

  // ── Folder 操作 ──

  ipcMain.handle(IPC.FOLDER_CREATE, async (_event, title: string, parentId?: string | null) => {
    if (!isDBReady()) return null;
    const folder = await folderStore.create(title, parentId);
    broadcastContentTree(getMainWindow());
    return folder;
  });

  ipcMain.handle(IPC.FOLDER_RENAME, async (_event, id: string, title: string) => {
    if (!isDBReady()) return;
    await folderStore.rename(id, title);
    broadcastContentTree(getMainWindow());
  });

  ipcMain.handle(IPC.FOLDER_DELETE, async (_event, id: string) => {
    if (!isDBReady()) return;
    await folderStore.delete(id);
    broadcastContentTree(getMainWindow());
  });

  ipcMain.handle(IPC.FOLDER_MOVE, async (_event, id: string, parentId: string | null) => {
    if (!isDBReady()) return;
    await folderStore.move(id, parentId);
    broadcastContentTree(getMainWindow());
  });

  ipcMain.handle(IPC.FOLDER_LIST, async () => {
    if (!isDBReady()) return [];
    return folderStore.list();
  });

  // NavSide 请求打开笔记 → 广播给所有 View（NoteView 会响应）
  ipcMain.handle(IPC.NOTE_OPEN_IN_EDITOR, async (_event, noteId: string) => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return;
    // 广播给所有 WebContentsView
    for (const view of mainWindow.contentView.children) {
      if ('webContents' in view) {
        (view as any).webContents.send(IPC.NOTE_OPEN_IN_EDITOR, noteId);
      }
    }
  });

  // ── 文件保存对话框 ──
  ipcMain.handle(IPC.FILE_SAVE_DIALOG, async (_event, options: {
    defaultName: string;
    data: string;         // base64 编码的文件内容
    filters?: { name: string; extensions: string[] }[];
  }) => {
    const { dialog } = await import('electron');
    const { writeFile } = await import('fs/promises');
    const mainWindow = getMainWindow();
    const result = await dialog.showSaveDialog(mainWindow as any, {
      defaultPath: options.defaultName,
      filters: options.filters || [{ name: 'All Files', extensions: ['*'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const buffer = Buffer.from(options.data, 'base64');
    await writeFile(result.filePath, buffer);
    return { canceled: false, filePath: result.filePath };
  });
}

/** 广播 NoteFile 列表变更 */
function broadcastNoteList(mainWindow: BaseWindow | null): void {
  if (!mainWindow) return;
  noteStore.list().then((list) => {
    for (const view of mainWindow.contentView.children) {
      if ('webContents' in view) {
        (view as any).webContents.send(IPC.NOTE_LIST_CHANGED, list);
      }
    }
  }).catch(() => {});
}

/** 广播完整内容树（folder + note 列表同时刷新） */
function broadcastContentTree(mainWindow: BaseWindow | null): void {
  broadcastNoteList(mainWindow);
  // folder 列表也通过 NOTE_LIST_CHANGED 触发 NavSide 刷新
  // NavSide 收到后会重新 fetch folderList
}

function broadcastWorkspaceState(mainWindow: BaseWindow | null): void {
  updateLayout();

  if (!mainWindow) return;

  const state = {
    workspaces: workspaceManager.getAll(),
    activeId: workspaceManager.getActiveId(),
    active: workspaceManager.getActive(),
  };

  for (const view of mainWindow.contentView.children) {
    if ('webContents' in view) {
      view.webContents.send(IPC.WORKSPACE_STATE_CHANGED, state);
    }
  }
}
