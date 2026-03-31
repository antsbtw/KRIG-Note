import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../../shared/types';

/**
 * Divider preload — 拖拽分割线的 API
 */
contextBridge.exposeInMainWorld('dividerAPI', {
  onDragStart: (screenX: number) => ipcRenderer.send(IPC.DIVIDER_DRAG_START, screenX),
  onDragMove: (screenX: number) => ipcRenderer.send(IPC.DIVIDER_DRAG_MOVE, screenX),
  onDragEnd: (screenX: number) => ipcRenderer.send(IPC.DIVIDER_DRAG_END, screenX),
});
