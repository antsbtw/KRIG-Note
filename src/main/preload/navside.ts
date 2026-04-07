import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../../shared/types';

/**
 * NavSide preload — 导航侧栏的 API
 */
contextBridge.exposeInMainWorld('navSideAPI', {
  // WorkMode
  listWorkModes: () => ipcRenderer.invoke(IPC.WORKMODE_LIST),
  switchWorkMode: (id: string) => ipcRenderer.invoke(IPC.WORKMODE_SWITCH, id),

  // NavSide
  toggle: () => ipcRenderer.invoke(IPC.NAVSIDE_TOGGLE),

  // Right Slot
  openRightSlot: (workModeId: string) => ipcRenderer.invoke(IPC.SLOT_OPEN_RIGHT, workModeId),
  closeRightSlot: () => ipcRenderer.invoke(IPC.SLOT_CLOSE_RIGHT),

  // NavSide 宽度拖拽
  resizeStart: (screenX: number) => ipcRenderer.send(IPC.NAVSIDE_RESIZE_START, screenX),
  resizeMove: (screenX: number) => ipcRenderer.send(IPC.NAVSIDE_RESIZE_MOVE, screenX),
  resizeEnd: () => ipcRenderer.send(IPC.NAVSIDE_RESIZE_END),

  // NoteFile 操作
  noteCreate: (title?: string) => ipcRenderer.invoke(IPC.NOTE_CREATE, title),
  noteList: () => ipcRenderer.invoke(IPC.NOTE_LIST),
  noteDelete: (id: string) => ipcRenderer.invoke(IPC.NOTE_DELETE, id),
  noteRename: (id: string, title: string) => ipcRenderer.invoke(IPC.NOTE_RENAME, id, title),
  noteMoveToFolder: (noteId: string, folderId: string | null) => ipcRenderer.invoke(IPC.NOTE_MOVE_TO_FOLDER, noteId, folderId),
  noteOpenInEditor: (id: string) => ipcRenderer.invoke(IPC.NOTE_OPEN_IN_EDITOR, id),

  // Folder 操作
  folderCreate: (title: string, parentId?: string | null) => ipcRenderer.invoke(IPC.FOLDER_CREATE, title, parentId),
  folderRename: (id: string, title: string) => ipcRenderer.invoke(IPC.FOLDER_RENAME, id, title),
  folderDelete: (id: string) => ipcRenderer.invoke(IPC.FOLDER_DELETE, id),
  folderMove: (id: string, parentId: string | null) => ipcRenderer.invoke(IPC.FOLDER_MOVE, id, parentId),
  folderList: () => ipcRenderer.invoke(IPC.FOLDER_LIST),

  onNoteListChanged: (callback: (list: unknown[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, list: unknown[]) => callback(list);
    ipcRenderer.on(IPC.NOTE_LIST_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.NOTE_LIST_CHANGED, listener);
  },

  isDBReady: () => ipcRenderer.invoke(IPC.IS_DB_READY),

  onDBReady: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(IPC.DB_READY, listener);
    return () => ipcRenderer.removeListener(IPC.DB_READY, listener);
  },

  // Workspace 状态同步
  setExpandedFolders: (folderIds: string[]) => ipcRenderer.invoke(IPC.SET_EXPANDED_FOLDERS, folderIds),
  onRestoreWorkspaceState: (callback: (state: { activeNoteId: string | null; expandedFolders: string[] }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: any) => callback(state);
    ipcRenderer.on(IPC.RESTORE_WORKSPACE_STATE, listener);
    return () => ipcRenderer.removeListener(IPC.RESTORE_WORKSPACE_STATE, listener);
  },

  // 获取当前 Workspace 状态（初始化用）
  getActiveState: () => ipcRenderer.invoke(IPC.WORKSPACE_LIST),

  // 状态监听
  onStateChanged: (callback: (state: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
    ipcRenderer.on(IPC.WORKSPACE_STATE_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.WORKSPACE_STATE_CHANGED, listener);
  },

  // ── NavSide 注册制 ──

  getNavSideRegistration: (workModeId: string) =>
    ipcRenderer.invoke(IPC.NAVSIDE_GET_REGISTRATION, workModeId),

  // ── eBook 书架 ──

  ebookBookshelfList: () => ipcRenderer.invoke(IPC.EBOOK_BOOKSHELF_LIST),
  ebookPickFile: () => ipcRenderer.invoke(IPC.EBOOK_PICK_FILE),
  ebookBookshelfAdd: (filePath: string, fileType: string, storage: 'managed' | 'link') =>
    ipcRenderer.invoke(IPC.EBOOK_BOOKSHELF_ADD, filePath, fileType, storage),
  ebookBookshelfOpen: (id: string) => ipcRenderer.invoke(IPC.EBOOK_BOOKSHELF_OPEN, id),
  ebookBookshelfRemove: (id: string) => ipcRenderer.invoke(IPC.EBOOK_BOOKSHELF_REMOVE, id),
  ebookBookshelfRename: (id: string, displayName: string) =>
    ipcRenderer.invoke(IPC.EBOOK_BOOKSHELF_RENAME, id, displayName),
  ebookBookshelfMove: (id: string, folderId: string | null) =>
    ipcRenderer.invoke(IPC.EBOOK_BOOKSHELF_MOVE, id, folderId),

  // eBook 文件夹
  ebookFolderList: () => ipcRenderer.invoke(IPC.EBOOK_FOLDER_LIST),
  ebookFolderCreate: (title: string, parentId?: string | null) =>
    ipcRenderer.invoke(IPC.EBOOK_FOLDER_CREATE, title, parentId),
  ebookFolderRename: (id: string, title: string) =>
    ipcRenderer.invoke(IPC.EBOOK_FOLDER_RENAME, id, title),
  ebookFolderDelete: (id: string) =>
    ipcRenderer.invoke(IPC.EBOOK_FOLDER_DELETE, id),
  ebookFolderMove: (id: string, parentId: string | null) =>
    ipcRenderer.invoke(IPC.EBOOK_FOLDER_MOVE, id, parentId),

  onEbookBookshelfChanged: (callback: (list: unknown[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, list: unknown[]) => callback(list);
    ipcRenderer.on(IPC.EBOOK_BOOKSHELF_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.EBOOK_BOOKSHELF_CHANGED, listener);
  },
});
