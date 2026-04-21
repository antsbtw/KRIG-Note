import { workModeRegistry } from '../../../main/workmode/registry';
import { navSideRegistry } from '../../../main/navside/registry';
import { protocolRegistry } from '../../../main/protocol/registry';
import { menuRegistry } from '../../../main/menu/registry';
import type { PluginContext } from '../../../shared/plugin-types';
import { registerEBookIpcHandlers } from './ipc-handlers';

/**
 * eBook Plugin — 框架注册
 *
 * 注册 EBookView 的 WorkMode、NavSide、Protocol、Menu、IPC Handlers。
 */

export function register(ctx: PluginContext): void {
  // ── IPC Handlers ──
  registerEBookIpcHandlers(ctx.getMainWindow);
  // ── WorkMode ──
  workModeRegistry.register({
    id: 'demo-b',
    viewType: 'ebook',
    icon: '📕',
    label: 'eBook',
    order: 2,
  });

  // ── NavSide ──
  navSideRegistry.register({
    workModeId: 'demo-b',
    actionBar: { title: '书架', actions: [
      { id: 'create-ebook-folder', label: '+ 文件夹' },
      { id: 'import-ebook', label: '+ 导入' },
    ]},
    contentType: 'ebook-bookshelf',
  });

  // ── Protocol ──
  protocolRegistry.register({ id: 'demo-sync',         match: { left: { type: 'note' },  right: { type: 'ebook' } } });
  protocolRegistry.register({ id: 'demo-sync-reverse',  match: { left: { type: 'ebook' }, right: { type: 'note' } } });
  protocolRegistry.register({ id: 'ebook-extraction',   match: { left: { type: 'ebook' }, right: { type: 'web', variant: 'extraction' } } });
  protocolRegistry.register({ id: 'ebook-ebook',        match: { left: { type: 'ebook' }, right: { type: 'ebook' } } });
  protocolRegistry.register({ id: 'ebook-web',          match: { left: { type: 'ebook' }, right: { type: 'web' } } });
  protocolRegistry.register({ id: 'web-ebook',          match: { left: { type: 'web' },   right: { type: 'ebook' } } });
  protocolRegistry.register({ id: 'ebook-ai',           match: { left: { type: 'ebook' }, right: { type: 'web', variant: 'ai' } } });

  // ── Menu ──
  menuRegistry.register({
    id: 'ebook-menu',
    label: 'eBook',
    order: 11,
    items: [
      { id: 'open-ebook', label: 'Open eBook...', accelerator: 'CmdOrCtrl+O', handler: async () => {
        const { dialog } = await import('electron');
        const win = ctx.getMainWindow();
        if (!win) return;
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

        const { bookshelfStore: store } = await import('../../../main/ebook/bookshelf-store');
        const entry = store.addManaged(filePath, fileType);

        // 广播书架变更
        const list = store.list();
        for (const child of win.contentView.children) {
          if ('webContents' in child) {
            (child as any).webContents.send('ebook:bookshelf-changed', list);
          }
        }

        // 加载文件并通知 EBookView
        const { loadEBook } = await import('../../../main/ebook/file-loader');
        await loadEBook(entry.filePath);
        for (const child of win.contentView.children) {
          if ('webContents' in child) {
            (child as any).webContents.send('ebook:loaded', { fileName: entry.displayName, fileType: entry.fileType });
          }
        }
      }},
      { id: 'sep1', label: '', separator: true, handler: () => {} },
      { id: 'bookmark', label: 'Add Bookmark', accelerator: 'CmdOrCtrl+D', handler: () => console.log('Bookmark') },
    ],
  });
}
