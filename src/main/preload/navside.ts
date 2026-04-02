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

  onNoteListChanged: (callback: (list: unknown[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, list: unknown[]) => callback(list);
    ipcRenderer.on(IPC.NOTE_LIST_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.NOTE_LIST_CHANGED, listener);
  },

  onDBReady: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(IPC.DB_READY, listener);
    return () => ipcRenderer.removeListener(IPC.DB_READY, listener);
  },

  // 状态监听
  onStateChanged: (callback: (state: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
    ipcRenderer.on(IPC.WORKSPACE_STATE_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.WORKSPACE_STATE_CHANGED, listener);
  },
});
