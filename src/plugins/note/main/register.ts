import { workModeRegistry } from '../../../main/workmode/registry';
import { navSideRegistry } from '../../../main/navside/registry';
import { protocolRegistry } from '../../../main/protocol/registry';
import { menuRegistry } from '../../../main/menu/registry';
import type { PluginContext } from '../../../shared/plugin-types';
import { registerNoteIpcHandlers } from './ipc-handlers';

/**
 * Note Plugin — 框架注册
 *
 * 注册 NoteView 的 WorkMode、NavSide、Protocol、Menu、IPC Handlers。
 * 由 app.ts 在启动时调用，插件不直接操作框架内部。
 */

export function register(ctx: PluginContext): void {
  // ── IPC Handlers ──
  registerNoteIpcHandlers(ctx.getMainWindow);
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
      { id: 'create-note', label: '+ 新建' },
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
        const { backupStore } = await import('../../../main/storage/backup-store');
        const r = await backupStore.backup(result.filePath);
        if (r.success) {
          dialog.showMessageBox(win as any, { type: 'info', title: 'Backup Complete', message: `Backup saved to:\n${result.filePath}\n(${((r.size || 0) / 1024 / 1024).toFixed(1)} MB)` });
        } else {
          dialog.showMessageBox(win as any, { type: 'error', title: 'Backup Failed', message: r.error || 'Unknown error' });
        }
      }},
      { id: 'restore', label: 'Restore from Backup...', handler: async () => {
        const { dialog } = await import('electron');
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
        const { backupStore } = await import('../../../main/storage/backup-store');
        const r = await backupStore.restore(openResult.filePaths[0]);
        dialog.showMessageBox(win as any, {
          type: r.success ? 'info' : 'error',
          title: r.success ? 'Restore Complete' : 'Restore Failed',
          message: r.success ? 'Data restored successfully. Please restart the app.' : (r.error || 'Unknown error'),
        });
      }},
    ],
  });
}
