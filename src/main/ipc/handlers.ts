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

export function registerIpcHandlers(getMainWindow: () => BaseWindow | null): void {
  // ── Workspace 操作 ──

  ipcMain.handle(IPC.WORKSPACE_LIST, () => {
    return {
      workspaces: workspaceManager.getAll(),
      activeId: workspaceManager.getActiveId(),
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
    const workspace = workspaceManager.setActive(id);
    if (workspace) {
      switchWorkspace(oldActiveId, id);
      broadcastWorkspaceState(getMainWindow());
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

  ipcMain.handle(IPC.WORKSPACE_RENAME, (_event, id: string, label: string) => {
    workspaceManager.rename(id, label);
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
