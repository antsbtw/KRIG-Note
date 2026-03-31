import { app } from 'electron';
import { createShell, getMainWindow } from './window/shell';
import { registerIpcHandlers } from './ipc/handlers';
import { setupDividerController } from './slot/divider';
import { getNavSideWidth, setNavSideWidth } from './slot/layout';
import { workspaceManager } from './workspace/manager';
import { workModeRegistry } from './workmode/registry';
import { protocolRegistry } from './protocol/registry';
import { menuRegistry } from './menu/registry';
import { loadSession, saveSession, buildSession } from './storage/session-store';

/**
 * KRIG Note — 应用入口
 *
 * 启动流程：
 * 1. 注册插件（WorkMode、协议、Menu）
 * 2. 注册 IPC 处理器 + Divider 控制器
 * 3. 创建默认 Workspace
 * 4. 创建主窗口
 * 5. 构建 Application Menu
 */

// ── 插件注册区 ──

function registerPlugins(): void {
  // WorkMode 注册
  workModeRegistry.register({
    id: 'demo-a',
    viewType: 'note',
    icon: '📝',
    label: 'Demo A',
    order: 1,
  });

  workModeRegistry.register({
    id: 'demo-b',
    viewType: 'pdf',
    icon: '📕',
    label: 'Demo B',
    order: 2,
  });

  workModeRegistry.register({
    id: 'demo-c',
    viewType: 'web',
    icon: '🌐',
    label: 'Demo C',
    order: 3,
  });

  // 协同协议注册
  protocolRegistry.register({
    id: 'demo-sync',
    match: { left: { type: 'note' }, right: { type: 'pdf' } },
  });

  protocolRegistry.register({
    id: 'demo-sync-reverse',
    match: { left: { type: 'pdf' }, right: { type: 'note' } },
  });

  // Application Menu 注册（全局稳定，始终显示所有菜单）

  menuRegistry.register({
    id: 'edit',
    label: 'Edit',
    order: 1,
    items: [
      { id: 'undo', label: 'Undo', accelerator: 'CmdOrCtrl+Z', handler: () => {} },
      { id: 'redo', label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', handler: () => {} },
      { id: 'sep1', label: '', separator: true, handler: () => {} },
      { id: 'cut', label: 'Cut', accelerator: 'CmdOrCtrl+X', handler: () => {} },
      { id: 'copy', label: 'Copy', accelerator: 'CmdOrCtrl+C', handler: () => {} },
      { id: 'paste', label: 'Paste', accelerator: 'CmdOrCtrl+V', handler: () => {} },
      { id: 'select-all', label: 'Select All', accelerator: 'CmdOrCtrl+A', handler: () => {} },
    ],
  });

  menuRegistry.register({
    id: 'view',
    label: 'View',
    order: 2,
    items: [
      { id: 'toggle-navside', label: 'Toggle NavSide', accelerator: 'CmdOrCtrl+\\', handler: () => {
        const active = workspaceManager.getActive();
        if (active) {
          workspaceManager.update(active.id, { navSideVisible: !active.navSideVisible });
        }
      }},
      { id: 'sep1', label: '', separator: true, handler: () => {} },
      { id: 'devtools', label: 'Developer Tools', accelerator: 'CmdOrCtrl+Alt+I', handler: () => {
        const win = getMainWindow();
        if (win) {
          for (const child of win.contentView.children) {
            if ('webContents' in child && child.webContents.isFocused()) {
              child.webContents.toggleDevTools();
              break;
            }
          }
        }
      }},
    ],
  });

  menuRegistry.register({
    id: 'note-menu',
    label: 'Note',
    order: 10,
    items: [
      { id: 'new-note', label: 'New Note', accelerator: 'CmdOrCtrl+N', handler: () => console.log('New Note') },
      { id: 'save-note', label: 'Save', accelerator: 'CmdOrCtrl+S', handler: () => console.log('Save Note') },
      { id: 'sep1', label: '', separator: true, handler: () => {} },
      { id: 'export-md', label: 'Export as Markdown', handler: () => console.log('Export MD') },
    ],
  });

  menuRegistry.register({
    id: 'pdf-menu',
    label: 'PDF',
    order: 11,
    items: [
      { id: 'open-pdf', label: 'Open PDF...', accelerator: 'CmdOrCtrl+O', handler: () => console.log('Open PDF') },
      { id: 'sep1', label: '', separator: true, handler: () => {} },
      { id: 'bookmark', label: 'Add Bookmark', accelerator: 'CmdOrCtrl+D', handler: () => console.log('Bookmark') },
    ],
  });

  menuRegistry.register({
    id: 'web-menu',
    label: 'Web',
    order: 12,
    items: [
      { id: 'go-back', label: 'Back', accelerator: 'CmdOrCtrl+[', handler: () => console.log('Go Back') },
      { id: 'go-forward', label: 'Forward', accelerator: 'CmdOrCtrl+]', handler: () => console.log('Go Forward') },
      { id: 'sep1', label: '', separator: true, handler: () => {} },
      { id: 'extract', label: 'Extract Page', handler: () => console.log('Extract') },
    ],
  });

  menuRegistry.register({
    id: 'window',
    label: 'Window',
    order: 20,
    items: [
      { id: 'minimize', label: 'Minimize', accelerator: 'CmdOrCtrl+M', handler: () => {
        getMainWindow()?.minimize();
      }},
      { id: 'close', label: 'Close Window', accelerator: 'CmdOrCtrl+W', handler: () => {
        getMainWindow()?.close();
      }},
    ],
  });

  menuRegistry.register({
    id: 'help',
    label: 'Help',
    order: 100,
    items: [
      { id: 'about', label: 'About KRIG Note', handler: () => console.log('About') },
      { id: 'shortcuts', label: 'Keyboard Shortcuts', handler: () => console.log('Shortcuts') },
    ],
  });
}

// ── 应用生命周期 ──

app.whenReady().then(() => {
  // 1. 插件注册
  registerPlugins();

  // 2. IPC 处理器 + Divider 控制器
  registerIpcHandlers(getMainWindow);
  setupDividerController(getMainWindow);

  // 3. 恢复 Session 或创建默认 Workspace
  const session = loadSession();
  if (session && session.workspaces.length > 0) {
    // 恢复已有 Session
    for (const ws of session.workspaces) {
      const created = workspaceManager.create(ws.label);
      workspaceManager.update(created.id, {
        workModeId: ws.workModeId,
        navSideVisible: ws.navSideVisible,
        dividerRatio: ws.dividerRatio,
      });
    }
    // 恢复活跃 Workspace（用索引，因为 ID 会重新生成）
    const all = workspaceManager.getAll();
    const activeIndex = session.workspaces.findIndex(
      (ws) => ws.id === session.activeWorkspaceId,
    );
    const activeWs = all[activeIndex >= 0 ? activeIndex : 0];
    if (activeWs) workspaceManager.setActive(activeWs.id);

    // 恢复 NavSide 宽度
    if (session.navSideWidth) setNavSideWidth(session.navSideWidth);
  } else {
    // 首次启动：创建默认 Workspace
    const defaultWorkspace = workspaceManager.create('Workspace 1');
    workspaceManager.setActive(defaultWorkspace.id);
  }

  // 4. 创建主窗口
  createShell();

  // 5. 构建 Application Menu
  menuRegistry.rebuild();
});

// ── 保存 Session ──

function persistSession(): void {
  saveSession(buildSession(
    workspaceManager.getAll(),
    workspaceManager.getActiveId(),
    getNavSideWidth(),
  ));
}

// 定时自动保存（每 30 秒）
setInterval(persistSession, 30_000);

// 退出前保存
app.on('before-quit', () => {
  persistSession();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (!getMainWindow()) {
    createShell();
  }
});
