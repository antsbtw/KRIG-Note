import { workModeRegistry } from '../../../main/workmode/registry';
import { navSideRegistry } from '../../../main/navside/registry';
import { protocolRegistry } from '../../../main/protocol/registry';
import { menuRegistry } from '../../../main/menu/registry';
import type { PluginContext } from '../../../shared/plugin-types';
import { IPC } from '../../../shared/types';
import { noteStore } from '../../../main/storage/note-store';
import { folderStore } from '../../../main/storage/folder-store';
import { registerNoteIpcHandlers } from './ipc-handlers';

/**
 * Note Plugin — 框架注册
 *
 * 注册 NoteView 的 WorkMode、NavSide、Protocol、Menu、IPC Handlers。
 * 由 app.ts 在启动时调用，插件不直接操作框架内部。
 */

export function register(ctx: PluginContext): void {
  // ── IPC Handlers ──
  registerNoteIpcHandlers(ctx);
  // ── WorkMode ──
  workModeRegistry.register({
    id: 'demo-a',
    viewType: 'note',
    icon: '📝',
    label: 'Note',
    order: 1,
  });

  // ── NavSide ──
  navSideRegistry.register({
    workModeId: 'demo-a',
    actionBar: { title: '笔记目录', actions: [
      { id: 'create-folder', label: '+ 文件夹' },
      { id: 'create-note', label: '+ 笔记' },
    ]},
    contentType: 'note-list',
    contextMenu: [
      { id: 'create-note', label: '新建笔记', icon: '📄' },
      { id: 'create-folder', label: '新建文件夹', icon: '📁' },
      { id: 'sep-1', label: '', separator: true },
      { id: 'paste', label: '粘贴', icon: '📋' },
      { id: 'sep-2', label: '', separator: true },
      { id: 'sort-by-title', label: '按名称排序', icon: '↕' },
      { id: 'sort-by-date', label: '按修改时间排序', icon: '↕' },
    ],
  });

  // ── NavSide Action Handlers ──
  const broadcastNoteList = () => {
    const win = ctx.getMainWindow();
    if (!win) return;
    noteStore.list().then((list) => {
      for (const view of win.contentView.children) {
        if ('webContents' in view) (view as any).webContents.send(IPC.NOTE_LIST_CHANGED, list);
      }
    }).catch(() => {});
  };

  navSideRegistry.registerAction('demo-a', 'create-note', async (params) => {
    const folderId = (params.folderId as string) ?? null;
    const note = await noteStore.create('新建笔记', folderId);
    broadcastNoteList();
    return { id: note.id, title: note.title };
  });

  navSideRegistry.registerAction('demo-a', 'create-folder', async (params) => {
    const parentId = (params.parentId as string) ?? null;
    const folder = await folderStore.create('新建文件夹', parentId);
    broadcastNoteList();
    return { id: folder.id, title: folder.title };
  });

  navSideRegistry.registerAction('demo-a', 'paste', async (params) => {
    const clipboardType = params.clipboardType as string;
    const clipboardId = params.clipboardId as string;
    const targetFolderId = (params.targetFolderId as string) ?? null;

    if (clipboardType === 'folder') {
      // 递归复制文件夹
      async function duplicateFolder(srcId: string, destParentId: string | null): Promise<void> {
        const allFolders = await folderStore.list();
        const srcFolder = allFolders.find(f => f.id === srcId);
        if (!srcFolder) return;
        const newFolder = await folderStore.create(srcFolder.title + ' (副本)', destParentId);
        const allNotes = await noteStore.list();
        for (const note of allNotes.filter(n => n.folder_id === srcId)) {
          await noteStore.duplicate(note.id, newFolder.id);
        }
        for (const child of allFolders.filter(f => f.parent_id === srcId)) {
          await duplicateFolder(child.id, newFolder.id);
        }
      }
      await duplicateFolder(clipboardId, targetFolderId);
    } else {
      await noteStore.duplicate(clipboardId, targetFolderId);
    }
    broadcastNoteList();
    return { success: true };
  });

  // ── Protocol ──
  protocolRegistry.register({ id: 'note-thought', match: { left: { type: 'note' }, right: { type: 'thought' } } });
  protocolRegistry.register({ id: 'note-web',     match: { left: { type: 'note' }, right: { type: 'web' } } });
  protocolRegistry.register({ id: 'note-note',    match: { left: { type: 'note' }, right: { type: 'note' } } });
  protocolRegistry.register({ id: 'note-ai',      match: { left: { type: 'note' }, right: { type: 'web', variant: 'ai' } } });

  // ── Menu ──
  menuRegistry.register({
    id: 'note-menu',
    label: 'Note',
    order: 10,
    items: [
      { id: 'new-note', label: 'New Note', accelerator: 'CmdOrCtrl+N', handler: () => console.log('New Note') },
      { id: 'save-note', label: 'Save', accelerator: 'CmdOrCtrl+S', handler: () => console.log('Save Note') },
      { id: 'sep1', label: '', separator: true, handler: () => {} },
      { id: 'import-json', label: 'Import JSON...', handler: async () => {
        const { dialog } = await import('electron');
        const fs = await import('node:fs');
        const win = ctx.getMainWindow();
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
          console.error('[Note] Import JSON failed:', err);
        }
      }},
      { id: 'import-markdown', label: 'Import Markdown...', handler: async () => {
        const { dialog } = await import('electron');
        const fs = await import('node:fs');
        const path = await import('node:path');
        const win = ctx.getMainWindow();
        if (!win) return;
        const result = await dialog.showOpenDialog(win as any, {
          title: 'Import Markdown',
          filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
          properties: ['openFile', 'multiSelections'],
        });
        if (result.canceled || result.filePaths.length === 0) return;
        const files: { markdown: string; title: string }[] = [];
        for (const filePath of result.filePaths) {
          try {
            const markdown = fs.readFileSync(filePath, 'utf-8');
            const title = path.basename(filePath, path.extname(filePath));
            files.push({ markdown, title });
          } catch (err) {
            console.error('[Note] Read Markdown failed:', filePath, err);
          }
        }
        if (files.length === 0) return;
        for (const child of win.contentView.children) {
          if ('webContents' in child) {
            (child as any).webContents.send('note:import-markdown', files);
          }
        }
      }},
      { id: 'export-md', label: 'Export as Markdown', handler: () => console.log('Export MD') },
      { id: 'sep-backup', label: '', separator: true, handler: () => {} },
      { id: 'backup', label: 'Backup All Data...', handler: async () => {
        const { dialog } = await import('electron');
        const win = ctx.getMainWindow();
        if (!win) return;
        const result = await dialog.showSaveDialog(win as any, {
          title: 'Backup All Data',
          defaultPath: `krig-backup-${new Date().toISOString().slice(0, 10)}.tar.gz`,
          filters: [{ name: 'KRIG Backup', extensions: ['tar.gz'] }],
        });
        if (result.canceled || !result.filePath) return;
        const filePath = result.filePath;
        const { backupStore } = await import('../../../main/storage/backup-store');
        await ctx.runWithProgress('数据备份中', (report) => backupStore.backup(filePath, report), {
          doneMessage: (r) => r.success
            ? { success: true, message: `备份完成 (${((r.size || 0) / 1024 / 1024).toFixed(1)} MB)` }
            : { success: false, message: r.error || 'Unknown error' },
        });
      }},
      { id: 'restore', label: 'Restore from Backup...', handler: async () => {
        const { dialog, app } = await import('electron');
        const win = ctx.getMainWindow();
        if (!win) return;
        const confirm = await dialog.showMessageBox(win as any, {
          type: 'warning', buttons: ['Cancel', 'Restore'], defaultId: 0,
          title: 'Restore from Backup', message: 'This will replace ALL current data with the backup. Are you sure?',
        });
        if (confirm.response === 0) return;
        const openResult = await dialog.showOpenDialog(win as any, {
          title: 'Select Backup File', filters: [{ name: 'KRIG Backup', extensions: ['tar.gz'] }], properties: ['openFile'],
        });
        if (openResult.canceled || openResult.filePaths.length === 0) return;
        const archivePath = openResult.filePaths[0];
        const { backupStore } = await import('../../../main/storage/backup-store');
        const result = await ctx.runWithProgress('数据恢复中', (report) => backupStore.restore(archivePath, report), {
          doneMessage: (r) => r.success
            ? { success: true, message: '恢复完成。应用即将退出，请手动启动。' }
            : { success: false, message: r.error || 'Unknown error' },
        });
        if (result.success) {
          // 自动退出，用户手动重启（避免 relaunch 在 dev 模式下黑屏）
          setTimeout(() => app.exit(0), 1500);
        }
      }},
    ],
  });
}
