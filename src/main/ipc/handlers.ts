import { ipcMain, BaseWindow, dialog, shell } from 'electron';
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
  closeSlot,
  getSlotBySenderId,
  getActiveViewWebContentsIds,
  getActiveProtocol,
  hasRightSlot,
  isRightSlotMode,
} from '../window/shell';
import { clampNavSideWidth, getDefaultNavSideWidth } from '../slot/layout';
import { getSlotLock, setSlotLock } from '../slot/lock';
import { noteStore } from '../storage/note-store';
import { activityStore } from '../storage/activity-store';
import { isDBReady } from '../storage/client';
import { ebookStore as bookshelfStore } from '../ebook/bookshelf-surreal-store';
import { mediaSurrealStore as mediaStore } from '../media/media-surreal-store';
import { navSideRegistry } from '../navside/registry';

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
              rightActiveNoteId: workspace.rightActiveNoteId,
              expandedFolders: workspace.expandedFolders,
              activeBookId: workspace.activeBookId,
              ebookExpandedFolders: workspace.ebookExpandedFolders,
              activeGraphId: workspace.activeGraphId,
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
    // 剥离 onViewCreated 等函数字段（函数无法通过 IPC 序列化）
    return workModeRegistry.getAll().map(({ onViewCreated, ...rest }) => rest);
  });

  ipcMain.handle(IPC.WORKMODE_SWITCH, (_event, workModeId: string) => {
    const active = workspaceManager.getActive();
    if (!active) return;
    workspaceManager.update(active.id, { workModeId });
    if (hasRightSlot()) closeRightSlot();
    switchLeftSlotView(workModeId);
    broadcastWorkspaceState(getMainWindow());
  });

  // ── Slot 操作 ──

  ipcMain.handle(IPC.SLOT_OPEN_RIGHT, (_event, workModeId: string) => {
    openRightSlot(workModeId);
    broadcastWorkspaceState(getMainWindow());
  });

  // 确保 Right Slot 打开（不 toggle：已打开同类 view 时不关闭）
  ipcMain.handle(IPC.SLOT_ENSURE_RIGHT, (_event, workModeId: string) => {
    if (!hasRightSlot() || !isRightSlotMode(workModeId)) {
      openRightSlot(workModeId);
      broadcastWorkspaceState(getMainWindow());
    }
  });

  ipcMain.handle(IPC.SLOT_CLOSE_RIGHT, () => {
    closeRightSlot();
    broadcastWorkspaceState(getMainWindow());
  });

  // View 关闭自己所在的 slot（自动检测 sender 在哪个 slot）
  ipcMain.handle(IPC.SLOT_CLOSE, (event) => {
    const side = getSlotBySenderId(event.sender.id);
    if (!side) return;
    closeSlot(side);
    broadcastWorkspaceState(getMainWindow());
  });

  // View 查询自己在哪个 slot（用于同步滚动的左主右从仲裁）
  ipcMain.handle(IPC.SLOT_GET_SIDE, (event) => {
    return getSlotBySenderId(event.sender.id);
  });

  // Slot 位置锁：session 级状态，切断 anchor-sync 发送
  ipcMain.handle(IPC.SLOT_LOCK_GET, () => getSlotLock());
  ipcMain.handle(IPC.SLOT_LOCK_SET, (_event, next: boolean) => {
    setSlotLock(!!next, getMainWindow());
    return getSlotLock();
  });

  // ── View 间消息路由（双工，宽松模式） ──

  ipcMain.on(IPC.VIEW_MESSAGE_SEND, (event, message: ViewMessage) => {
    const mainWindow = getMainWindow();
    if (!mainWindow) {
      return;
    }

    // 协议匹配检查：只有注册了协议的 View 组合才允许通信
    const activeProtocol = getActiveProtocol();
    if (activeProtocol === null) {
      return;
    }

    const { leftId, rightId } = getActiveViewWebContentsIds();
    const senderId = event.sender.id;

    // 路由到"对面"的 View
    let targetId: number | null = null;
    if (senderId === leftId) {
      targetId = rightId;
    } else if (senderId === rightId) {
      targetId = leftId;
    }

    if (targetId === null) {
      return;
    }

    // 在所有 child views 中找到目标并发送
    for (const child of mainWindow.contentView.children) {
      if ('webContents' in child && (child as any).webContents.id === targetId) {
        (child as any).webContents.send(IPC.VIEW_MESSAGE_RECEIVE, message);
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

    const active = workspaceManager.getActive();
    if (!active) return;
    const currentWidth = active.navSideWidth ?? getDefaultNavSideWidth();
    workspaceManager.update(active.id, { navSideWidth: clampNavSideWidth(currentWidth + deltaX) });
    updateLayout();
  });

  ipcMain.on(IPC.NAVSIDE_RESIZE_END, () => {
    navResizeDragging = false;
  });

  // DB 就绪状态查询（防止 renderer 在 db:ready 事件之后加载时错过事件）
  ipcMain.handle(IPC.IS_DB_READY, () => {
    return isDBReady();
  });

  // ── NavSide 注册制 ──

  ipcMain.handle(IPC.NAVSIDE_GET_REGISTRATION, (_event, workModeId: string) => {
    return navSideRegistry.get(workModeId) ?? null;
  });

  ipcMain.handle(IPC.NAVSIDE_EXECUTE_ACTION, async (_event, actionId: string, params?: Record<string, unknown>) => {
    const active = workspaceManager.getActive();
    if (!active) return null;
    return navSideRegistry.executeAction(active.workModeId, actionId, params ?? {});
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

  // ── 文件打开对话框 ──
  ipcMain.handle(IPC.FILE_OPEN_DIALOG, async () => {
    const { dialog } = await import('electron');
    const mainWindow = getMainWindow();
    const result = await dialog.showOpenDialog(mainWindow as any, {
      properties: ['openFile'],
      filters: [{ name: 'All Files', extensions: ['*'] }],
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    return { canceled: false, filePath: result.filePaths[0] };
  });


  // ── 媒体操作 ──

  ipcMain.handle(IPC.MEDIA_DOWNLOAD, async (_e, url: string, mediaType: 'video' | 'audio') => {
    const type = mediaType === 'video' ? 'audio' : mediaType; // video 暂不支持，降级为 audio
    return mediaStore.download(url, type as 'audio' | 'image');
  });

  // MEDIA_PUT_BASE64: persist a base64/data-URL payload into the media
  // store and return a `media://...` URL. Renderer uses this when the
  // user uploads a file via a fileBlock/externalRef placeholder — we
  // don't want to embed the base64 into note JSON.
  ipcMain.handle(IPC.MEDIA_PUT_BASE64, async (_e, params: { input: string; mimeType?: string; filename?: string }) => {
    const { mediaSurrealStore } = await import('../media/media-surreal-store');
    return mediaSurrealStore.putBase64(params.input, params.mimeType, params.filename);
  });

  // MEDIA_PUT_FILE: copy a local file into the media store.
  ipcMain.handle(IPC.MEDIA_PUT_FILE, async (_e, filePath: string) => {
    const { readFile } = await import('fs/promises');
    const path = await import('path');
    const { mediaSurrealStore } = await import('../media/media-surreal-store');
    try {
      const data = await readFile(filePath);
      const filename = path.basename(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const MIME_MAP: Record<string, string> = {
        '.pdf': 'application/pdf', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json',
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
        '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm',
        '.zip': 'application/zip', '.gz': 'application/gzip', '.tar': 'application/x-tar',
        '.py': 'text/x-python', '.js': 'text/javascript', '.ts': 'text/typescript', '.html': 'text/html', '.css': 'text/css',
      };
      const mime = MIME_MAP[ext] || 'application/octet-stream';
      const base64 = `data:${mime};base64,${data.toString('base64')}`;
      return mediaSurrealStore.putBase64(base64, mime, filename);
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // MEDIA_RESOLVE_PATH: turn `media://bucket/name.ext` into the real disk
  // path at `{userData}/krig-data/media/bucket/name.ext`. The media://
  // protocol is only registered in Electron's renderer — the OS (and
  // therefore shell.openExternal) doesn't know it, so we resolve to a
  // filesystem path whenever we need shell.openPath / showItemInFolder.
  ipcMain.handle(IPC.MEDIA_RESOLVE_PATH, async (_e, mediaUrl: string) => {
    try {
      const { app } = await import('electron');
      const path = await import('node:path');
      const fs = await import('node:fs');
      if (!mediaUrl.startsWith('media://')) return { success: false, error: 'not a media:// URL' };
      const rel = mediaUrl.slice('media://'.length);
      const abs = path.join(app.getPath('userData'), 'krig-data', 'media', rel);
      if (!fs.existsSync(abs)) return { success: false, error: 'file not found', path: abs };
      return { success: true, path: abs };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // MEDIA_OPEN_PATH: open a local file with the system default handler.
  // Use after MEDIA_RESOLVE_PATH (or with any pre-resolved absolute path).
  ipcMain.handle(IPC.MEDIA_OPEN_PATH, async (_e, filePath: string) => {
    const result = await shell.openPath(filePath);
    // shell.openPath returns '' on success, error string on failure.
    return { success: !result, error: result || undefined };
  });

  ipcMain.handle(IPC.MEDIA_OPEN_EXTERNAL, async (_e, url: string) => {
    await shell.openExternal(url);
    return { success: true };
  });

  // MD_TO_PM_NODES: convert a Markdown string to ProseMirror-node JSON
  // blocks. Used by the renderer's smart-paste plugin after turning the
  // clipboard's text/html into Markdown.
  ipcMain.handle(IPC.MD_TO_PM_NODES, async (_e, markdown: string) => {
    try {
      const { markdownToProseMirror } = await import('../storage/md-to-pm');
      return await markdownToProseMirror(markdown);
    } catch (err) {
      console.warn('[MD_TO_PM_NODES] failed:', err);
      return [];
    }
  });

  ipcMain.handle(IPC.SHOW_ITEM_IN_FOLDER, (_e, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  // ── Backup/Restore ──

  ipcMain.handle(IPC.BACKUP_CREATE, async () => {
    const mainWindow = getMainWindow();
    const result = await dialog.showSaveDialog(mainWindow as any, {
      title: 'Backup All Data',
      defaultPath: `krig-backup-${new Date().toISOString().slice(0, 10)}.tar.gz`,
      filters: [{ name: 'KRIG Backup', extensions: ['tar.gz'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };

    const { backupStore } = await import('../storage/backup-store');
    return backupStore.backup(result.filePath);
  });

  ipcMain.handle(IPC.BACKUP_RESTORE, async () => {
    const mainWindow = getMainWindow();

    const confirm = await dialog.showMessageBox(mainWindow as any, {
      type: 'warning',
      buttons: ['Cancel', 'Restore'],
      defaultId: 0,
      title: 'Restore from Backup',
      message: 'This will replace ALL current data with the backup. Are you sure?',
    });
    if (confirm.response === 0) return { canceled: true };

    const openResult = await dialog.showOpenDialog(mainWindow as any, {
      title: 'Select Backup File',
      filters: [{ name: 'KRIG Backup', extensions: ['tar.gz'] }],
      properties: ['openFile'],
    });
    if (openResult.canceled || openResult.filePaths.length === 0) return { canceled: true };

    const { backupStore } = await import('../storage/backup-store');
    const restoreResult = await backupStore.restore(openResult.filePaths[0]);

    // 恢复成功后广播刷新
    if (restoreResult.success) {
      broadcastNoteList(mainWindow);
      broadcastWorkspaceState(mainWindow);
    }

    return restoreResult;
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
  }).catch((err) => {
    console.warn('[IPC] Failed to broadcast note list:', err);
  });
}

/** 广播完整内容树（folder + note 列表同时刷新） */
function broadcastContentTree(mainWindow: BaseWindow | null): void {
  broadcastNoteList(mainWindow);
  // folder 列表也通过 NOTE_LIST_CHANGED 触发 NavSide 刷新
  // NavSide 收到后会重新 fetch folderList
}

export function broadcastWorkspaceState(mainWindow: BaseWindow | null): void {
  updateLayout();

  if (!mainWindow) return;

  const state = {
    workspaces: workspaceManager.getAll(),
    activeId: workspaceManager.getActiveId(),
    active: workspaceManager.getActive(),
  };

  for (const view of mainWindow.contentView.children) {
    if ('webContents' in view) {
      (view as any).webContents.send(IPC.WORKSPACE_STATE_CHANGED, state);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// YouTube 字幕获取（使用 youtube-transcript 库，通过 InnerTube API）
// ═══════════════════════════════════════════════════════════


/** 广播生词本变更 */
/** 广播书架变更（→ NavSide） */
function broadcastBookshelfChanged(mainWindow: BaseWindow | null): void {
  if (!mainWindow) return;
  bookshelfStore.list().then((list) => {
    for (const view of mainWindow.contentView.children) {
      if ('webContents' in view) {
        (view as any).webContents.send(IPC.EBOOK_BOOKSHELF_CHANGED, list);
      }
    }
  }).catch((err) => {
    console.warn('[IPC] Failed to broadcast bookshelf list:', err);
  });
}

/** 通知 EBookView 文件已加载 */
function broadcastEBookLoaded(mainWindow: BaseWindow | null, info: {
  bookId: string; fileName: string; fileType: string;
  lastPosition?: { page?: number; scale?: number; fitWidth?: boolean; cfi?: string };
}): void {
  if (!mainWindow) return;
  for (const view of mainWindow.contentView.children) {
    if ('webContents' in view) {
      (view as any).webContents.send(IPC.EBOOK_LOADED, info);
    }
  }
}

