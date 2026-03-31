import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../../shared/types';

/**
 * Shell preload — WorkspaceBar 的 API
 */
contextBridge.exposeInMainWorld('shellAPI', {
  // Workspace 操作
  listWorkspaces: () => ipcRenderer.invoke(IPC.WORKSPACE_LIST),
  createWorkspace: () => ipcRenderer.invoke(IPC.WORKSPACE_CREATE),
  switchWorkspace: (id: string) => ipcRenderer.invoke(IPC.WORKSPACE_SWITCH, id),
  closeWorkspace: (id: string) => ipcRenderer.invoke(IPC.WORKSPACE_CLOSE, id),
  renameWorkspace: (id: string, label: string) => ipcRenderer.invoke(IPC.WORKSPACE_RENAME, id, label),

  // NavSide
  toggleNavSide: () => ipcRenderer.invoke(IPC.NAVSIDE_TOGGLE),

  // 状态监听
  onStateChanged: (callback: (state: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
    ipcRenderer.on(IPC.WORKSPACE_STATE_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.WORKSPACE_STATE_CHANGED, listener);
  },
});
