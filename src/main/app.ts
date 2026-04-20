import { app, nativeTheme, dialog } from 'electron';
import fs from 'node:fs';
import { createShell, getMainWindow } from './window/shell';
import { registerIpcHandlers } from './ipc/handlers';
import { setupDividerController } from './slot/divider';
import { workspaceManager } from './workspace/manager';
import { workModeRegistry } from './workmode/registry';
import { protocolRegistry } from './protocol/registry';
import { navSideRegistry } from './navside/registry';
import { menuRegistry } from './menu/registry';
import { loadSession, saveSession, buildSession } from './storage/session-store';
import { initSurrealDB, shutdownSurrealDB, isDBReady } from './storage/client';
import { initSchema } from './storage/schema';
import { migrateJsonToSurreal } from './storage/migrate-json-to-surreal';
import { surrealSessionStore } from './storage/surreal-session-store';
import { activityStore } from './storage/activity-store';
import { initKrigNoteDocs, createBlockTaskDoc, reimportTestDocs } from './storage/init-docs';
import { mediaSurrealStore as mediaStore } from './media/media-surreal-store';
import { setupExtractionInterceptor } from '../plugins/web/main/extraction-handler';
import { setupCSPBypass } from '../plugins/web-bridge/infrastructure/csp-bypass';
import { registerGuest } from '../plugins/web-bridge/infrastructure/guest-registry';
import { browserCapabilityServices, browserCapabilityTraceWriter } from '../plugins/browser-capability';

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

  workModeRegistry.register({
    id: 'extraction',
    viewType: 'web',
    variant: 'extraction',
    icon: '📤',
    label: 'Extraction',
    order: 4,
    hidden: true,   // 仅作为 right slot，不在 NavSide tab 中显示
    onViewCreated: (_view, guestWebContents) => {
      setupExtractionInterceptor(guestWebContents);
    },
  });

  workModeRegistry.register({
    id: 'web-translate',
    viewType: 'web',
    variant: 'translate',
    icon: '🌐',
    label: 'Translate',
    order: 5,
    hidden: true,
    onViewCreated: (_view, guestWebContents) => {
      setupCSPBypass(guestWebContents);
    },
  });

  workModeRegistry.register({
    id: 'ai-web',
    viewType: 'web',
    variant: 'ai',
    icon: '🤖',
    label: 'AI',
    order: 6,
    hidden: true,   // 仅作为 right slot（场景 A 标注模式）
    onViewCreated: (view, guestWebContents) => {
      setupCSPBypass(guestWebContents);
      registerGuest(view.webContents, guestWebContents);
    },
  });

  // 场景 C：AI 浏览同步模式 — Left Slot: AIWebView, Right Slot: NoteView
  workModeRegistry.register({
    id: 'ai-sync',
    viewType: 'web',
    variant: 'ai',
    icon: '🤖',
    label: 'AI',
    order: 4,
    hidden: false,   // 在 NavSide tab 中显示
    onViewCreated: (view, guestWebContents) => {
      setupCSPBypass(guestWebContents);
      registerGuest(view.webContents, guestWebContents);
    },
  });

  workModeRegistry.register({
    id: 'thought',
    viewType: 'thought',
    icon: '💭',
    label: 'Thought',
    order: 10,
    hidden: true,   // 不在 NavSide tab 中显示，仅作为 right slot
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

  navSideRegistry.register({
    workModeId: 'demo-c',
    actionBar: { title: '网页', actions: [
      { id: 'create-web-folder', label: '+ 文件夹' },
      { id: 'add-web-bookmark', label: '+ 书签' },
    ]},
    contentType: 'web-bookmarks',
  });

  // AI Sync NavSide — 显示 AI 服务选择（简化版）
  navSideRegistry.register({
    workModeId: 'ai-sync',
    actionBar: { title: 'AI 对话', actions: [] },
    contentType: 'ai-services',
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

  protocolRegistry.register({
    id: 'ebook-extraction',
    match: { left: { type: 'ebook' }, right: { type: 'web', variant: 'extraction' } },
  });

  protocolRegistry.register({
    id: 'note-thought',
    match: { left: { type: 'note' }, right: { type: 'thought' } },
  });

  // Cross-View Toggle 协议：允许任意 View 组合通信
  protocolRegistry.register({ id: 'note-web',    match: { left: { type: 'note' },  right: { type: 'web' } } });
  protocolRegistry.register({ id: 'web-note',    match: { left: { type: 'web' },   right: { type: 'note' } } });
  protocolRegistry.register({ id: 'web-ebook',   match: { left: { type: 'web' },   right: { type: 'ebook' } } });
  protocolRegistry.register({ id: 'ebook-web',   match: { left: { type: 'ebook' }, right: { type: 'web' } } });
  protocolRegistry.register({ id: 'note-note',   match: { left: { type: 'note' },  right: { type: 'note' } } });
  protocolRegistry.register({ id: 'ebook-ebook', match: { left: { type: 'ebook' }, right: { type: 'ebook' } } });
  protocolRegistry.register({ id: 'web-web',     match: { left: { type: 'web' },   right: { type: 'web' } } });
  protocolRegistry.register({ id: 'web-translate', match: { left: { type: 'web' }, right: { type: 'web', variant: 'translate' } } });

  // AI Workflow 协议
  protocolRegistry.register({ id: 'note-ai', match: { left: { type: 'note' }, right: { type: 'web', variant: 'ai' } } });
  protocolRegistry.register({ id: 'ebook-ai', match: { left: { type: 'ebook' }, right: { type: 'web', variant: 'ai' } } });

  // AI Sync 协议：左侧 AIWebView ↔ 右侧 NoteView（实时同步对话记录）
  protocolRegistry.register({ id: 'ai-sync', match: { left: { type: 'web', variant: 'ai' }, right: { type: 'note' } } });

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
      { id: 'devtools-web', label: 'DevTools (Web)', accelerator: 'CmdOrCtrl+Alt+W', handler: () => {
        openDevToolsByName('web');
      }},
      { id: 'devtools-navside', label: 'DevTools (NavSide)', accelerator: 'CmdOrCtrl+Alt+S', handler: () => {
        openDevToolsByName('navside');
      }},
      { id: 'devtools-shell', label: 'DevTools (Shell)', accelerator: 'CmdOrCtrl+Alt+H', handler: () => {
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
      { id: 'import-json', label: 'Import JSON...', handler: async () => {
        const win = getMainWindow();
        if (!win) return;
        const result = await dialog.showOpenDialog(win as any, {
          title: 'Import JSON',
          filters: [{ name: 'JSON', extensions: ['json'] }],
          properties: ['openFile'],
        });
        if (result.canceled || result.filePaths.length === 0) return;
        try {
          const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
          const data = JSON.parse(raw);
          for (const child of win.contentView.children) {
            if ('webContents' in child) {
              (child as any).webContents.send('note:import-json', data);
            }
          }
        } catch (err) {
          console.error('[Menu] Import JSON failed:', err);
        }
      }},
      { id: 'export-md', label: 'Export as Markdown', handler: () => console.log('Export MD') },
      { id: 'sep-backup', label: '', separator: true, handler: () => {} },
      { id: 'backup', label: 'Backup All Data...', handler: async () => {
        const win = getMainWindow();
        if (!win) return;
        const result = await dialog.showSaveDialog(win as any, {
          title: 'Backup All Data',
          defaultPath: `krig-backup-${new Date().toISOString().slice(0, 10)}.tar.gz`,
          filters: [{ name: 'KRIG Backup', extensions: ['tar.gz'] }],
        });
        if (result.canceled || !result.filePath) return;
        const { backupStore } = await import('./storage/backup-store');
        const r = await backupStore.backup(result.filePath);
        if (r.success) {
          dialog.showMessageBox(win as any, {
            type: 'info',
            title: 'Backup Complete',
            message: `Backup saved to:\n${result.filePath}\n(${((r.size || 0) / 1024 / 1024).toFixed(1)} MB)`,
          });
        } else {
          dialog.showMessageBox(win as any, {
            type: 'error',
            title: 'Backup Failed',
            message: r.error || 'Unknown error',
          });
        }
      }},
      { id: 'restore', label: 'Restore from Backup...', handler: async () => {
        const win = getMainWindow();
        if (!win) return;
        const confirm = await dialog.showMessageBox(win as any, {
          type: 'warning',
          buttons: ['Cancel', 'Restore'],
          defaultId: 0,
          title: 'Restore from Backup',
          message: 'This will replace ALL current data with the backup. Are you sure?',
        });
        if (confirm.response === 0) return;
        const openResult = await dialog.showOpenDialog(win as any, {
          title: 'Select Backup File',
          filters: [{ name: 'KRIG Backup', extensions: ['tar.gz'] }],
          properties: ['openFile'],
        });
        if (openResult.canceled || openResult.filePaths.length === 0) return;
        const { backupStore } = await import('./storage/backup-store');
        const r = await backupStore.restore(openResult.filePaths[0]);
        dialog.showMessageBox(win as any, {
          type: r.success ? 'info' : 'error',
          title: r.success ? 'Restore Complete' : 'Restore Failed',
          message: r.success ? 'Data restored successfully. Please restart the app.' : (r.error || 'Unknown error'),
        });
      }},
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
  // 0. 暗色主题（确保 webview 内的网页识别 prefers-color-scheme: dark）
  nativeTheme.themeSource = 'dark';

  // 0b. 注册自定义协议（必须在 app.whenReady 后）
  mediaStore.registerProtocol();

  // 1. 插件注册
  registerPlugins();

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
