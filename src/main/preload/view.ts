import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../../shared/types';
import type { ViewMessage } from '../../shared/types';

/**
 * View preload — 通用 View 的 API
 *
 * 所有 View 插件共享此 preload，提供基础通信能力。
 */
contextBridge.exposeInMainWorld('viewAPI', {
  // View 间消息（双工）
  sendToOtherSlot: (message: ViewMessage) => {
    ipcRenderer.send(IPC.VIEW_MESSAGE_SEND, message);
  },

  onMessage: (callback: (message: ViewMessage) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: ViewMessage) => callback(message);
    ipcRenderer.on(IPC.VIEW_MESSAGE_RECEIVE, listener);
    return () => ipcRenderer.removeListener(IPC.VIEW_MESSAGE_RECEIVE, listener);
  },

  // Right Slot 操作
  openRightSlot: (workModeId: string) => ipcRenderer.invoke(IPC.SLOT_OPEN_RIGHT, workModeId),
  closeRightSlot: () => ipcRenderer.invoke(IPC.SLOT_CLOSE_RIGHT),

  // 状态监听
  onStateChanged: (callback: (state: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
    ipcRenderer.on(IPC.WORKSPACE_STATE_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.WORKSPACE_STATE_CHANGED, listener);
  },
});
