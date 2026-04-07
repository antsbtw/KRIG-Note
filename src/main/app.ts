import { app } from 'electron';
import { createShell, getMainWindow } from './window/shell';
import { registerIpcHandlers } from './ipc/handlers';
import { setupDividerController } from './slot/divider';
import { getNavSideWidth, setNavSideWidth } from './slot/layout';
import { workspaceManager } from './workspace/manager';
import { workModeRegistry } from './workmode/registry';
import { protocolRegistry } from './protocol/registry';
import { navSideRegistry } from './navside/registry';
import { menuRegistry } from './menu/registry';
import { loadSession, saveSession, buildSession } from './storage/session-store';
import { initSurrealDB, shutdownSurrealDB, isDBReady } from './storage/client';
import { initSchema } from './storage/schema';
import { surrealSessionStore } from './storage/surreal-session-store';
import { activityStore } from './storage/activity-store';
import { initKrigNoteDocs, createBlockTaskDoc, reimportTestDocs } from './storage/init-docs';
import { mediaStore } from './media/media-store';

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
    label: 'Note',
    order: 1,
  });

  workModeRegistry.register({
    id: 'demo-b',
    viewType: 'ebook',
    icon: '📕',
    label: 'eBook',
    order: 2,
  });

  workModeRegistry.register({
    id: 'demo-c',
    viewType: 'web',
    icon: '🌐',
    label: 'Web',
    order: 3,
  });

  // NavSide 内容注册
  navSideRegistry.register({
    workModeId: 'demo-a',
    actionBar: { title: '笔记目录', actions: [
      { id: 'create-folder', label: '+ 文件夹' },
      { id: 'create-note', label: '+ 新建' },
    ]},
    contentType: 'note-list',
  });

  navSideRegistry.register({
    workModeId: 'demo-b',
    actionBar: { title: '书架', actions: [
      { id: 'create-ebook-folder', label: '+ 文件夹' },
      { id: 'import-ebook', label: '+ 导入' },
    ]},
    contentType: 'ebook-bookshelf',
  });

  // 协同协议注册
  protocolRegistry.register({
    id: 'demo-sync',
    match: { left: { type: 'note' }, right: { type: 'ebook' } },
  });

  protocolRegistry.register({
    id: 'demo-sync-reverse',
    match: { left: { type: 'ebook' }, right: { type: 'note' } },
  });

  // ── DevTools 辅助函数 ──
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

  // Application Menu 注册（全局稳定，始终显示所有菜单）

  // Edit 菜单：使用 Electron role（系统自动处理 Cmd+C/X/V/Z）
  menuRegistry.registerRoleMenu('edit', 'Edit', 1);

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
      { id: 'devtools-note', label: 'DevTools (Note)', accelerator: 'CmdOrCtrl+Alt+N', handler: () => {
        openDevToolsByName('note');
      }},
      { id: 'devtools-ebook', label: 'DevTools (eBook)', accelerator: 'CmdOrCtrl+Alt+F', handler: () => {
        openDevToolsByName('ebook');
      }},
      { id: 'devtools-navside', label: 'DevTools (NavSide)', accelerator: 'CmdOrCtrl+Alt+S', handler: () => {
        openDevToolsByName('navside');
      }},
      { id: 'devtools-shell', label: 'DevTools (Shell)', accelerator: 'CmdOrCtrl+Alt+W', handler: () => {
        openDevToolsByName('shell');
      }},
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
    id: 'ebook-menu',
    label: 'eBook',
    order: 11,
    items: [
      { id: 'open-ebook', label: 'Open eBook...', accelerator: 'CmdOrCtrl+O', handler: async () => {
        // 复用 IMPORT 逻辑：弹对话框 → 导入书架 → 加载 → 通知
        const { dialog } = await import('electron');
        const win = getMainWindow();
        const result = await dialog.showOpenDialog(win as any, {
          title: 'Open eBook',
          filters: [
            { name: 'eBook Files', extensions: ['pdf', 'epub', 'djvu', 'cbz'] },
            { name: 'PDF', extensions: ['pdf'] },
          ],
          properties: ['openFile'],
        });
        if (result.canceled || result.filePaths.length === 0) return;

        const filePath = result.filePaths[0];
        const ext = filePath.split('.').pop()?.toLowerCase() ?? 'pdf';
        const fileType = (['pdf', 'epub', 'djvu', 'cbz'].includes(ext) ? ext : 'pdf') as 'pdf' | 'epub' | 'djvu' | 'cbz';

        const { bookshelfStore: store } = await import('./ebook/bookshelf-store');
        const entry = store.addManaged(filePath, fileType);

        // 广播书架变更
        if (win) {
          const list = store.list();
          for (const child of win.contentView.children) {
            if ('webContents' in child) {
              (child as any).webContents.send('ebook:bookshelf-changed', list);
            }
          }
        }

        // 加载文件并通知 EBookView
        const { loadEBook } = await import('./ebook/file-loader');
        await loadEBook(entry.filePath);
        if (win) {
          for (const child of win.contentView.children) {
            if ('webContents' in child) {
              (child as any).webContents.send('ebook:loaded', { fileName: entry.displayName, fileType: entry.fileType });
            }
          }
        }
      }},
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
      { id: 'sep1', label: '', separator: true, handler: () => {} },
      { id: 'test-doc', label: 'Load Test Document', handler: () => {
        const win = getMainWindow();
        if (win) {
          for (const child of win.contentView.children) {
            if ('webContents' in child) {
              (child as any).webContents.send('note:load-test-doc');
            }
          }
        }
      }},
      { id: 'sep2', label: '', separator: true, handler: () => {} },
      { id: 'import-docs', label: 'Import KRIG-Note Docs', handler: async () => {
        try {
          const { created } = await initKrigNoteDocs();
          if (created > 0) {
            console.log(`[Help] Imported ${created} documents`);
            // 通知所有 renderer 刷新（通过 db:ready 触发全量刷新）
            const win = getMainWindow();
            if (win) {
              for (const child of win.contentView.children) {
                if ('webContents' in child) {
                  (child as any).webContents.send('db:ready');
                }
              }
            }
          } else {
            console.log('[Help] KRIG-Note docs already exist, skipping.');
          }
        } catch (err) {
          console.error('[Help] Import failed:', err);
        }
      }},
      { id: 'create-task', label: 'Create Block Task Doc', handler: async () => {
        const ok = await createBlockTaskDoc();
        if (ok) {
          const win = getMainWindow();
          if (win) {
            for (const child of win.contentView.children) {
              if ('webContents' in child) {
                (child as any).webContents.send('db:ready');
              }
            }
          }
        }
      }},
      { id: 'sep3', label: '', separator: true, handler: () => {} },
      { id: 'reimport-test', label: 'Reimport Test Docs', handler: async () => {
        const ok = await reimportTestDocs();
        if (ok) {
          const win = getMainWindow();
          if (win) {
            for (const child of win.contentView.children) {
              if ('webContents' in child) {
                (child as any).webContents.send('db:ready');
              }
            }
          }
        }
      }},
    ],
  });
}

// ── 应用生命周期 ──

app.whenReady().then(() => {
  // 0. 注册自定义协议（必须在 app.whenReady 后）
  mediaStore.registerProtocol();

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
        activeNoteId: ws.activeNoteId ?? null,
        expandedFolders: ws.expandedFolders ?? [],
        customLabel: ws.customLabel ?? false,
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

  // 6. 异步启动 SurrealDB（不阻塞窗口）
  initSurrealDB()
    .then(() => initSchema())
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
    getNavSideWidth(),
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
