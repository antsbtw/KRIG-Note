import { ipcMain, webContents } from 'electron';
import { IPC } from '../../../shared/types';
import type { PluginContext } from '../../../shared/plugin-types';
import { workspaceManager } from '../../../main/workspace/manager';
import { noteStore } from '../../../main/storage/note-store';
import { folderStore } from '../../../main/storage/folder-store';
import { activityStore } from '../../../main/storage/activity-store';
import { isDBReady } from '../../../main/storage/client';

/**
 * Note Plugin — IPC Handlers
 *
 * 处理所有 NOTE_*、FOLDER_* 相关的 IPC 通道。
 * 由 note/main/register.ts 在启动时调用。
 */

// 待打开的 noteId（导入完成后设置，NoteEditor ready 后拉取）
let pendingNoteId: string | null = null;

export function setPendingNoteId(noteId: string): void {
  pendingNoteId = noteId;
}

export function registerNoteIpcHandlers(ctx: PluginContext): void {
  const getMainWindow = ctx.getMainWindow;
  // ── 广播辅助 ──
  function broadcastNoteList(): void {
    const win = getMainWindow();
    if (!win) return;
    noteStore.list().then((list) => {
      for (const view of win.contentView.children) {
        if ('webContents' in view) {
          (view as any).webContents.send(IPC.NOTE_LIST_CHANGED, list);
        }
      }
    }).catch((err) => {
      console.warn('[Note IPC] Failed to broadcast note list:', err);
    });
  }

  function broadcastToAll(channel: string, ...args: unknown[]): void {
    const win = getMainWindow();
    if (!win) return;
    for (const child of win.contentView.children) {
      if ('webContents' in child) {
        (child as any).webContents.send(channel, ...args);
      }
    }
  }

  // ── NoteEditor ready 后拉取待打开的 noteId ──
  ipcMain.handle(IPC.NOTE_PENDING_OPEN, () => {
    const id = pendingNoteId;
    pendingNoteId = null;
    return id;
  });

  // ── Note CRUD ──
  ipcMain.handle(IPC.NOTE_CREATE, async (_event, title?: string) => {
    if (!isDBReady()) return null;
    const note = await noteStore.create(title);
    activityStore.log('note.create', note.id);
    broadcastNoteList();
    return note;
  });

  ipcMain.handle(IPC.NOTE_SAVE, async (_event, id: string, docContent: unknown[], title: string) => {
    if (!isDBReady()) return;
    await noteStore.save(id, docContent, title);
    activityStore.log('note.save', id);
    broadcastNoteList();
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
    broadcastNoteList();
    broadcastToAll(IPC.NOTE_DELETED, id);
  });

  ipcMain.handle(IPC.NOTE_RENAME, async (_event, id: string, title: string) => {
    if (!isDBReady()) return;
    await noteStore.rename(id, title);
    broadcastNoteList();
    broadcastToAll(IPC.NOTE_TITLE_CHANGED, { noteId: id, title });
  });

  ipcMain.handle(IPC.NOTE_LIST, async () => {
    if (!isDBReady()) return [];
    return noteStore.list();
  });

  ipcMain.handle(IPC.NOTE_SAVE_LAST_VIEW, async (_event, id: string, blockIndex: number) => {
    if (!isDBReady()) return;
    if (typeof blockIndex !== 'number' || !Number.isFinite(blockIndex) || blockIndex < 0) return;
    await noteStore.saveLastViewBlockIndex(id, Math.floor(blockIndex));
  });

  ipcMain.handle(IPC.NOTE_SAVE_BOOKMARKS, async (_event, id: string, bookmarks: unknown) => {
    if (!isDBReady()) return;
    if (!Array.isArray(bookmarks)) return;
    await noteStore.saveBookmarks(id, bookmarks as import('../../../main/storage/types').NoteBookmark[]);
    broadcastNoteList();
  });

  // ── Workspace 状态同步 ──
  ipcMain.handle(IPC.SET_ACTIVE_NOTE, (event, noteId: string | null, noteTitle?: string) => {
    const active = workspaceManager.getActive();
    if (!active) return;
    const slot = ctx.getSlotBySenderId(event.sender.id);
    if (slot === 'right') {
      workspaceManager.update(active.id, { rightActiveNoteId: noteId });
    } else {
      const updates: Record<string, unknown> = { activeNoteId: noteId };
      if (!active.customLabel && noteTitle) {
        updates.label = noteTitle;
      }
      workspaceManager.update(active.id, updates);
    }
  });

  ipcMain.handle(IPC.SET_EXPANDED_FOLDERS, (_event, folderIds: string[]) => {
    const active = workspaceManager.getActive();
    if (active) {
      workspaceManager.update(active.id, { expandedFolders: folderIds });
    }
  });

  // ── 笔记移动 ──
  ipcMain.handle(IPC.NOTE_MOVE_TO_FOLDER, async (_event, noteId: string, folderId: string | null) => {
    if (!isDBReady()) return;
    await noteStore.moveToFolder(noteId, folderId);
    broadcastNoteList();
  });

  ipcMain.handle(IPC.NOTE_DUPLICATE, async (_event, noteId: string, targetFolderId?: string | null) => {
    if (!isDBReady()) return null;
    const result = await noteStore.duplicate(noteId, targetFolderId);
    broadcastNoteList();
    return result;
  });

  ipcMain.handle(IPC.NOTE_OPEN_IN_EDITOR, async (event, noteId: string) => {
    // 根据发送者所在 slot 定向发送，左右独立互不干扰
    const senderId = event.sender.id;
    const slot = ctx.getSlotBySenderId(senderId);
    if (slot) {
      // view 内部触发（toolbar Open 按钮）→ 只发回自己
      event.sender.send(IPC.NOTE_OPEN_IN_EDITOR, noteId);
    } else {
      // NavSide 或其他非 slot view 触发 → 发给 left slot
      const { leftId } = ctx.getActiveViewWebContentsIds();
      if (leftId != null) {
        webContents.fromId(leftId)?.send(IPC.NOTE_OPEN_IN_EDITOR, noteId);
      }
    }
  });

  // ── Folder CRUD ──
  ipcMain.handle(IPC.FOLDER_CREATE, async (_event, title: string, parentId?: string | null) => {
    if (!isDBReady()) return null;
    const result = folderStore.create(title, parentId ?? null);
    broadcastNoteList();
    return result;
  });

  ipcMain.handle(IPC.FOLDER_RENAME, async (_event, id: string, title: string) => {
    if (!isDBReady()) return;
    await folderStore.rename(id, title);
    broadcastNoteList();
  });

  ipcMain.handle(IPC.FOLDER_DELETE, async (_event, id: string) => {
    if (!isDBReady()) return;
    await folderStore.delete(id);
    broadcastNoteList();
  });

  ipcMain.handle(IPC.FOLDER_MOVE, async (_event, id: string, parentId: string | null) => {
    if (!isDBReady()) return;
    await folderStore.move(id, parentId);
    broadcastNoteList();
  });

  // 递归复制文件夹（含子文件夹和笔记）
  ipcMain.handle(IPC.FOLDER_DUPLICATE, async (_event, folderId: string, targetParentId?: string | null) => {
    if (!isDBReady()) return null;

    async function duplicateFolder(srcId: string, destParentId: string | null): Promise<void> {
      // 1. 复制文件夹本身
      const allFolders = await folderStore.list();
      const srcFolder = allFolders.find(f => f.id === srcId);
      if (!srcFolder) return;

      const newFolder = await folderStore.create(srcFolder.title + ' (副本)', destParentId);

      // 2. 复制文件夹下的所有笔记
      const allNotes = await noteStore.list();
      const childNotes = allNotes.filter(n => n.folder_id === srcId);
      for (const note of childNotes) {
        await noteStore.duplicate(note.id, newFolder.id);
      }

      // 3. 递归复制子文件夹
      const childFolders = allFolders.filter(f => f.parent_id === srcId);
      for (const child of childFolders) {
        await duplicateFolder(child.id, newFolder.id);
      }
    }

    await duplicateFolder(folderId, targetParentId ?? null);
    broadcastNoteList();
  });

  ipcMain.handle(IPC.FOLDER_LIST, async () => {
    if (!isDBReady()) return [];
    return folderStore.list();
  });
}
