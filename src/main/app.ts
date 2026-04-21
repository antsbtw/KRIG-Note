import { app, nativeTheme } from 'electron';
import { createShell, getMainWindow } from './window/shell';
import { registerIpcHandlers } from './ipc/handlers';
import { setupDividerController } from './slot/divider';
import { workspaceManager } from './workspace/manager';
import { menuRegistry } from './menu/registry';
import { loadSession, saveSession, buildSession } from './storage/session-store';
import { initSurrealDB, shutdownSurrealDB } from './storage/client';
import { initSchema } from './storage/schema';
import { migrateJsonToSurreal } from './storage/migrate-json-to-surreal';
import { activityStore } from './storage/activity-store';
import { initKrigNoteDocs, createBlockTaskDoc, reimportTestDocs } from './storage/init-docs';
import { mediaSurrealStore as mediaStore } from './media/media-surreal-store';
import { browserCapabilityServices, browserCapabilityTraceWriter } from '../plugins/browser-capability';

// ── 插件注册 ──
import { register as registerNotePlugin } from '../plugins/note/main/register';
import { register as registerEBookPlugin } from '../plugins/ebook/main/register';
import { register as registerWebPlugin } from '../plugins/web/main/register';
import { register as registerThoughtPlugin } from '../plugins/thought/main/register';

/**
 * KRIG Note — 应用入口
 *
 * 启动流程：
 * 1. 注册插件（各插件自注册 WorkMode、协议、Menu、NavSide）
 * 2. 注册框架菜单（View、Window、Help）
 * 3. 注册 IPC 处理器 + Divider 控制器
 * 4. 创建默认 Workspace
 * 5. 创建主窗口
 * 6. 构建 Application Menu
 */

// ── 插件注册 ──

function registerPlugins(): void {
  // 延迟导入 shell 函数，避免循环依赖
  const ctx = {
    getMainWindow,
    openCompanion: (workModeId: string) => {
      const { openRightSlot } = require('./window/shell');
      return openRightSlot(workModeId);
    },
    ensureCompanion: (workModeId: string) => {
      const { openRightSlot } = require('./window/shell');
      return openRightSlot(workModeId); // ensureRightSlot 内部逻辑相同
    },
  };

  // L5 插件各自注册 WorkMode / NavSide / Protocol / Menu
  registerNotePlugin(ctx);
  registerEBookPlugin(ctx);
  registerWebPlugin(ctx);
  registerThoughtPlugin();
}

// ── L2 框架菜单注册（View / Window / Help — 不含任何 View 专属逻辑） ──

function registerFrameworkMenus(): void {
  // Edit 菜单：使用 Electron role（系统自动处理 Cmd+C/X/V/Z）
  menuRegistry.registerRoleMenu('edit', 'Edit', 1);

  // DevTools 辅助
  function openDevToolsByName(name: string): void {
    const win = getMainWindow();
    if (!win) return;
    for (const child of win.contentView.children) {
      if ('webContents' in child) {
        const url = (child as any).webContents.getURL() as string;
        if (url.includes(name)) {
          (child as any).webContents.toggleDevTools();
          return;
        }
      }
    }
  }

  // 广播到所有 View
  function broadcastToAll(channel: string, ...args: unknown[]): void {
    const win = getMainWindow();
    if (!win) return;
    for (const child of win.contentView.children) {
      if ('webContents' in child) {
        (child as any).webContents.send(channel, ...args);
      }
    }
  }

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
      { id: 'devtools-note', label: 'DevTools (Note)', accelerator: 'CmdOrCtrl+Alt+N', handler: () => openDevToolsByName('note') },
      { id: 'devtools-ebook', label: 'DevTools (eBook)', accelerator: 'CmdOrCtrl+Alt+F', handler: () => openDevToolsByName('ebook') },
      { id: 'devtools-web', label: 'DevTools (Web)', accelerator: 'CmdOrCtrl+Alt+W', handler: () => openDevToolsByName('web') },
      { id: 'devtools-navside', label: 'DevTools (NavSide)', accelerator: 'CmdOrCtrl+Alt+S', handler: () => openDevToolsByName('navside') },
      { id: 'devtools-shell', label: 'DevTools (Shell)', accelerator: 'CmdOrCtrl+Alt+H', handler: () => openDevToolsByName('shell') },
      { id: 'devtools-focused', label: 'DevTools (Focused)', accelerator: 'CmdOrCtrl+Alt+I', handler: () => {
        const win = getMainWindow();
        if (win) {
          for (const child of win.contentView.children) {
            if ('webContents' in child && (child as any).webContents.isFocused()) {
              (child as any).webContents.toggleDevTools();
              break;
            }
          }
        }
      }},
    ],
  });

  menuRegistry.register({
    id: 'window',
    label: 'Window',
    order: 20,
    items: [
      { id: 'minimize', label: 'Minimize', accelerator: 'CmdOrCtrl+M', handler: () => { getMainWindow()?.minimize(); }},
      { id: 'close', label: 'Close Window', accelerator: 'CmdOrCtrl+W', handler: () => { getMainWindow()?.close(); }},
    ],
  });

  menuRegistry.register({
    id: 'help',
    label: 'Help',
    order: 100,
    items: [
      { id: 'about', label: 'About KRIG Note', handler: () => console.log('About') },
      { id: 'shortcuts', label: 'Keyboard Shortcuts', handler: () => console.log('Shortcuts') },
      { id: 'sep1', label: '', separator: true, handler: () => {} },
      { id: 'test-doc', label: 'Load Test Document', handler: () => broadcastToAll('note:load-test-doc') },
      { id: 'sep2', label: '', separator: true, handler: () => {} },
      { id: 'import-docs', label: 'Import KRIG-Note Docs', handler: async () => {
        try {
          const { created } = await initKrigNoteDocs();
          if (created > 0) broadcastToAll('db:ready');
        } catch (err) { console.error('[Help] Import failed:', err); }
      }},
      { id: 'create-task', label: 'Create Block Task Doc', handler: async () => {
        if (await createBlockTaskDoc()) broadcastToAll('db:ready');
      }},
      { id: 'sep3', label: '', separator: true, handler: () => {} },
      { id: 'reimport-test', label: 'Reimport Test Docs', handler: async () => {
        if (await reimportTestDocs()) broadcastToAll('db:ready');
      }},
    ],
  });
}

// ── 应用生命周期 ──

app.whenReady().then(() => {
  // 0. 暗色主题（确保 webview 内的网页识别 prefers-color-scheme: dark）
  nativeTheme.themeSource = 'dark';

  // 0b. 注册自定义协议（必须在 app.whenReady 后）
  mediaStore.registerProtocol();

  // 1. 插件注册 + 框架菜单
  registerPlugins();
  registerFrameworkMenus();

  // 2. IPC 处理器 + Divider 控制器
  registerIpcHandlers(getMainWindow);
  setupDividerController(getMainWindow);

  if (!app.isPackaged) {
    browserCapabilityTraceWriter.init();
    const meta = browserCapabilityTraceWriter.getCurrentMeta();
    if (meta) {
      console.log('[BrowserCapability][Trace] run-ready', meta);
    }
    void browserCapabilityServices.core.subscribeLifecycle((event) => {
      browserCapabilityTraceWriter.writeLifecycle(event);
    });
  }

  // 3. 恢复 Session 或创建默认 Workspace
  const session = loadSession();
  if (session && session.workspaces.length > 0) {
    // 恢复已有 Session（保留原始 Workspace ID）
    for (const ws of session.workspaces) {
      workspaceManager.restore({
        id: ws.id,
        label: ws.label,
        customLabel: ws.customLabel ?? false,
        workModeId: ws.workModeId,
        navSideVisible: ws.navSideVisible,
        navSideWidth: ws.navSideWidth ?? session.navSideWidth ?? null,
        dividerRatio: ws.dividerRatio,
        activeNoteId: ws.activeNoteId ?? null,
        expandedFolders: ws.expandedFolders ?? [],
        activeBookId: ws.activeBookId ?? null,
        ebookExpandedFolders: ws.ebookExpandedFolders ?? [],
        slotBinding: ws.slotBinding ?? { left: null, right: null },
      });
    }
    // 恢复活跃 Workspace（直接按 ID 匹配）
    const activeWs = workspaceManager.get(session.activeWorkspaceId ?? '')
      ?? workspaceManager.getAll()[0];
    if (activeWs) workspaceManager.setActive(activeWs.id);
  } else {
    // 首次启动：创建默认 Workspace
    const defaultWorkspace = workspaceManager.create('Workspace 1');
    workspaceManager.setActive(defaultWorkspace.id);
  }

  // 4. 创建主窗口
  createShell();

  // 5. 构建 Application Menu
  menuRegistry.rebuild();

  // 6. 异步启动 SurrealDB（不阻塞窗口）
  initSurrealDB()
    .then(() => initSchema())
    .then(() => migrateJsonToSurreal())
    .then(() => {
      console.log('[KRIG] SurrealDB ready');
      activityStore.log('app.start');

      // 未来：从 SurrealDB 恢复 Session、加载 NoteFile 列表
      // 通知 renderer SurrealDB 就绪
      const win = getMainWindow();
      if (win) {
        for (const child of win.contentView.children) {
          if ('webContents' in child) {
            (child as any).webContents.send('db:ready');
          }
        }
      }
    })
    .catch((err) => {
      console.error('[KRIG] SurrealDB init failed:', err);
    });
});

// ── 保存 Session ──

function persistSession(): void {
  saveSession(buildSession(
    workspaceManager.getAll(),
    workspaceManager.getActiveId(),
  ));
}

// 定时自动保存（每 30 秒）
setInterval(persistSession, 30_000);

// 退出前保存 + 关闭 SurrealDB
app.on('before-quit', () => {
  persistSession();
  activityStore.log('app.quit').catch(() => {});
  shutdownSurrealDB();
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
