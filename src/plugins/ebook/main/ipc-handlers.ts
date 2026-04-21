import { ipcMain, BaseWindow, dialog } from 'electron';
import { IPC } from '../../../shared/types';
import { workspaceManager } from '../../../main/workspace/manager';
import { ebookStore as bookshelfStore } from '../../../main/ebook/bookshelf-surreal-store';
import { annotationSurrealStore as annotationStore } from '../../../main/ebook/annotation-surreal-store';
import { loadEBook, getEBookData, closeEBook } from '../../../main/ebook/file-loader';

/**
 * eBook Plugin — IPC Handlers
 *
 * 处理所有 EBOOK_* 相关的 IPC 通道。
 */

export function registerEBookIpcHandlers(getMainWindow: () => BaseWindow | null): void {
  // ── 广播辅助 ──
  function broadcastBookshelfChanged(): void {
    const win = getMainWindow();
    if (!win) return;
    bookshelfStore.list().then((list) => {
      for (const view of win.contentView.children) {
        if ('webContents' in view) {
          (view as any).webContents.send(IPC.EBOOK_BOOKSHELF_CHANGED, list);
        }
      }
    }).catch(() => {});
  }

  function broadcastEBookLoaded(info: Record<string, unknown>): void {
    const win = getMainWindow();
    if (!win) return;
    for (const child of win.contentView.children) {
      if ('webContents' in child) {
        (child as any).webContents.send(IPC.EBOOK_LOADED, info);
      }
    }
  }

  // ── 书架 CRUD ──
  ipcMain.handle(IPC.EBOOK_BOOKSHELF_LIST, async () => {
    return bookshelfStore.list();
  });

  ipcMain.handle(IPC.EBOOK_PICK_FILE, async () => {
    const mainWindow = getMainWindow();
    const result = await dialog.showOpenDialog(mainWindow as any, {
      title: 'Import eBook',
      filters: [
        { name: 'eBook Files', extensions: ['pdf', 'epub', 'djvu', 'cbz'] },
        { name: 'PDF', extensions: ['pdf'] },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const ext = filePath.split('.').pop()?.toLowerCase() ?? 'pdf';
    const fileType = (['pdf', 'epub', 'djvu', 'cbz'].includes(ext) ? ext : 'pdf') as 'pdf' | 'epub' | 'djvu' | 'cbz';
    const fileName = filePath.split('/').pop() ?? filePath;
    return { filePath, fileName, fileType };
  });

  ipcMain.handle(IPC.EBOOK_BOOKSHELF_ADD, async (_event, filePath: string, fileType: string, storage: 'managed' | 'link') => {
    const ft = fileType as 'pdf' | 'epub' | 'djvu' | 'cbz';
    const entry = storage === 'managed'
      ? await bookshelfStore.addManaged(filePath, ft)
      : await bookshelfStore.addLinked(filePath, ft);
    broadcastBookshelfChanged();
    await loadEBook(entry.filePath);
    broadcastEBookLoaded({ bookId: entry.id, fileName: entry.displayName, fileType: entry.fileType });
    return entry;
  });

  ipcMain.handle(IPC.EBOOK_BOOKSHELF_OPEN, async (_event, id: string) => {
    const entry = await bookshelfStore.get(id);
    if (!entry) return { success: false, error: 'Entry not found' };
    const exists = await bookshelfStore.checkExists(id);
    if (!exists) return { success: false, error: 'File not found' };
    await bookshelfStore.updateOpened(id);
    await loadEBook(entry.filePath);
    broadcastEBookLoaded({ bookId: entry.id, fileName: entry.displayName, fileType: entry.fileType, lastPosition: entry.lastPosition });
    broadcastBookshelfChanged();
    return { success: true };
  });

  ipcMain.handle(IPC.EBOOK_BOOKSHELF_REMOVE, async (_event, id: string) => {
    await bookshelfStore.remove(id);
    broadcastBookshelfChanged();
  });

  ipcMain.handle(IPC.EBOOK_BOOKSHELF_RENAME, async (_event, id: string, displayName: string) => {
    await bookshelfStore.rename(id, displayName);
    broadcastBookshelfChanged();
  });

  ipcMain.handle(IPC.EBOOK_BOOKSHELF_MOVE, async (_event, id: string, folderId: string | null) => {
    await bookshelfStore.moveToFolder(id, folderId);
    broadcastBookshelfChanged();
  });

  // ── eBook 文件夹 ──
  ipcMain.handle(IPC.EBOOK_FOLDER_LIST, async () => bookshelfStore.folderList());
  ipcMain.handle(IPC.EBOOK_FOLDER_CREATE, async (_event, title: string, parentId?: string | null) => {
    const folder = await bookshelfStore.folderCreate(title, parentId);
    broadcastBookshelfChanged();
    return folder;
  });
  ipcMain.handle(IPC.EBOOK_FOLDER_RENAME, async (_event, id: string, title: string) => {
    await bookshelfStore.folderRename(id, title);
    broadcastBookshelfChanged();
  });
  ipcMain.handle(IPC.EBOOK_FOLDER_DELETE, async (_event, id: string) => {
    await bookshelfStore.folderDelete(id);
    broadcastBookshelfChanged();
  });
  ipcMain.handle(IPC.EBOOK_FOLDER_MOVE, async (_event, id: string, parentId: string | null) => {
    await bookshelfStore.folderMove(id, parentId);
    broadcastBookshelfChanged();
  });

  // ── eBook 数据传输 ──
  ipcMain.handle(IPC.EBOOK_GET_DATA, () => getEBookData());
  ipcMain.handle(IPC.EBOOK_CLOSE, () => closeEBook());

  ipcMain.handle(IPC.EBOOK_RESTORE, async () => {
    const active = workspaceManager.getActive();
    if (!active?.activeBookId) return null;
    const entry = await bookshelfStore.get(active.activeBookId);
    if (!entry) return null;
    const exists = await bookshelfStore.checkExists(entry.id);
    if (!exists) return null;
    await loadEBook(entry.filePath);
    return { bookId: entry.id, fileName: entry.displayName, fileType: entry.fileType, lastPosition: entry.lastPosition };
  });

  // ── 书签 ──
  ipcMain.handle(IPC.EBOOK_BOOKMARK_TOGGLE, async (_event, bookId: string, page: number) => bookshelfStore.toggleBookmark(bookId, page));
  ipcMain.handle(IPC.EBOOK_BOOKMARK_LIST, async (_event, bookId: string) => bookshelfStore.getBookmarks(bookId));

  // ── CFI 书签（EPUB）──
  ipcMain.handle(IPC.EBOOK_CFI_BOOKMARK_ADD, async (_event, bookId: string, cfi: string, label: string) => bookshelfStore.addCFIBookmark(bookId, cfi, label));
  ipcMain.handle(IPC.EBOOK_CFI_BOOKMARK_REMOVE, async (_event, bookId: string, cfi: string) => bookshelfStore.removeCFIBookmark(bookId, cfi));
  ipcMain.handle(IPC.EBOOK_CFI_BOOKMARK_LIST, async (_event, bookId: string) => bookshelfStore.getCFIBookmarks(bookId));

  // ── 标注 ──
  ipcMain.handle(IPC.EBOOK_ANNOTATION_LIST, async (_event, bookId: string) => annotationStore.list(bookId));
  ipcMain.handle(IPC.EBOOK_ANNOTATION_ADD, async (_event, bookId: string, ann: any) => annotationStore.add(bookId, ann));
  ipcMain.handle(IPC.EBOOK_ANNOTATION_REMOVE, async (_event, bookId: string, annotationId: string) => annotationStore.remove(bookId, annotationId));

  // ── Workspace 状态 ──
  ipcMain.handle(IPC.EBOOK_SET_EXPANDED_FOLDERS, (_event, folderIds: string[]) => {
    const active = workspaceManager.getActive();
    if (active) workspaceManager.update(active.id, { ebookExpandedFolders: folderIds });
  });

  ipcMain.handle(IPC.EBOOK_SET_ACTIVE_BOOK, (_event, bookId: string | null) => {
    const active = workspaceManager.getActive();
    if (active) workspaceManager.update(active.id, { activeBookId: bookId });
  });

  ipcMain.handle(IPC.EBOOK_SAVE_PROGRESS, async (_event, bookId: string, position: { page?: number; scale?: number; fitWidth?: boolean; cfi?: string }) => {
    await bookshelfStore.updateProgress(bookId, position);
  });
}
