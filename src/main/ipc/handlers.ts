import { ipcMain, BaseWindow, BrowserWindow, dialog, shell, net } from 'electron';
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
  closeSlot,
  getSlotBySenderId,
  getActiveViewWebContentsIds,
  getActiveProtocol,
  hasRightSlot,
  isRightSlotMode,
} from '../window/shell';
import { clampNavSideWidth, getDefaultNavSideWidth } from '../slot/layout';
import { noteStore } from '../storage/note-store';
import { thoughtStore } from '../storage/thought-store';
import { graphStore } from '../association/graph-store';
import { folderStore } from '../storage/folder-store';
import { activityStore } from '../storage/activity-store';
import { isDBReady } from '../storage/client';
import { lookupWord } from '../learning/dictionary-service';
import { googleTranslate, googleTTS } from '../learning/providers/google-translate';
import { vocabStore } from '../learning/vocabulary-store';
import { mediaSurrealStore as mediaStore } from '../media/media-surreal-store';
import { checkStatus as ytdlpCheckStatus, install as ytdlpInstall } from '../ytdlp/binary-manager';
import { downloadVideo, getVideoInfo, saveTranslationSubtitle } from '../ytdlp/downloader';
import { loadEBook, getEBookData, closeEBook } from '../ebook/file-loader';
import { ebookStore as bookshelfStore } from '../ebook/bookshelf-surreal-store';
import { annotationSurrealStore as annotationStore } from '../ebook/annotation-surreal-store';
import { navSideRegistry } from '../navside/registry';
import { bookmarkSurrealStore as webBookmarkStore } from '../../plugins/web/main/bookmark-surreal-store';
import { historySurrealStore as webHistoryStore } from '../../plugins/web/main/history-surreal-store';

// 待打开的 noteId（导入完成后设置，NoteEditor ready 后拉取）
let pendingNoteId: string | null = null;

export function setPendingNoteId(noteId: string): void {
  pendingNoteId = noteId;
}

export function registerIpcHandlers(getMainWindow: () => BaseWindow | null): void {
  // NoteEditor ready 后拉取待打开的 noteId
  ipcMain.handle(IPC.NOTE_PENDING_OPEN, () => {
    const id = pendingNoteId;
    pendingNoteId = null;
    console.log('[IPC] NOTE_PENDING_OPEN:', id ?? '(none)');
    return id;
  });

  // ── Workspace 操作 ──

  ipcMain.handle(IPC.WORKSPACE_LIST, () => {
    return {
      workspaces: workspaceManager.getAll(),
      activeId: workspaceManager.getActiveId(),
      active: workspaceManager.getActive(),
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

    // 保存当前 NavSide 展开状态到旧 Workspace（由 NavSide 通过 broadcastWorkspaceState 间接保存）
    const workspace = workspaceManager.setActive(id);
    if (workspace) {
      switchWorkspace(oldActiveId, id);
      broadcastWorkspaceState(getMainWindow());

      // 通知所有 View 恢复新 Workspace 的状态
      const mainWindow = getMainWindow();
      if (mainWindow) {
        for (const child of mainWindow.contentView.children) {
          if ('webContents' in child) {
            (child as any).webContents.send(IPC.RESTORE_WORKSPACE_STATE, {
              activeNoteId: workspace.activeNoteId,
              expandedFolders: workspace.expandedFolders,
              activeBookId: workspace.activeBookId,
              ebookExpandedFolders: workspace.ebookExpandedFolders,
            });
          }
        }
      }
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

  ipcMain.handle(IPC.WORKSPACE_REORDER, (_event, ids: string[]) => {
    workspaceManager.reorder(ids);
    broadcastWorkspaceState(getMainWindow());
  });

  ipcMain.handle(IPC.WORKSPACE_RENAME, (_event, id: string, label: string) => {
    workspaceManager.rename(id, label);
    // 标记为用户自定义名称（不再自动跟随笔记标题）
    workspaceManager.update(id, { customLabel: true });
    broadcastWorkspaceState(getMainWindow());
  });

  // ── WorkMode 操作 ──

  ipcMain.handle(IPC.WORKMODE_LIST, () => {
    // 剥离 onViewCreated 等函数字段（函数无法通过 IPC 序列化）
    return workModeRegistry.getAll().map(({ onViewCreated, ...rest }) => rest);
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

  // 确保 Right Slot 打开（不 toggle：已打开同类 view 时不关闭）
  ipcMain.handle(IPC.SLOT_ENSURE_RIGHT, (_event, workModeId: string) => {
    if (!hasRightSlot() || !isRightSlotMode(workModeId)) {
      openRightSlot(workModeId);
      broadcastWorkspaceState(getMainWindow());
    }
  });

  ipcMain.handle(IPC.SLOT_CLOSE_RIGHT, () => {
    closeRightSlot();
    broadcastWorkspaceState(getMainWindow());
  });

  // View 关闭自己所在的 slot（自动检测 sender 在哪个 slot）
  ipcMain.handle(IPC.SLOT_CLOSE, (event) => {
    const side = getSlotBySenderId(event.sender.id);
    if (!side) return;
    closeSlot(side);
    broadcastWorkspaceState(getMainWindow());
  });

  // ── View 间消息路由（双工，宽松模式） ──

  ipcMain.on(IPC.VIEW_MESSAGE_SEND, (event, message: ViewMessage) => {
    const mainWindow = getMainWindow();
    if (!mainWindow) {
      console.log('[IPC:ViewMessage] No main window');
      return;
    }

    // 协议匹配检查：只有注册了协议的 View 组合才允许通信
    const activeProtocol = getActiveProtocol();
    if (activeProtocol === null) {
      console.log('[IPC:ViewMessage] No active protocol, message dropped:', message.action);
      return;
    }

    const { leftId, rightId } = getActiveViewWebContentsIds();
    const senderId = event.sender.id;
    console.log(`[IPC:ViewMessage] protocol=${activeProtocol}, sender=${senderId}, left=${leftId}, right=${rightId}, action=${message.action}`);

    // 路由到"对面"的 View
    let targetId: number | null = null;
    if (senderId === leftId) {
      targetId = rightId;
    } else if (senderId === rightId) {
      targetId = leftId;
    }

    if (targetId === null) {
      console.log('[IPC:ViewMessage] Sender not in any slot, dropped');
      return;
    }

    // 在所有 child views 中找到目标并发送
    for (const child of mainWindow.contentView.children) {
      if ('webContents' in child && (child as any).webContents.id === targetId) {
        (child as any).webContents.send(IPC.VIEW_MESSAGE_RECEIVE, message);
        console.log(`[IPC:ViewMessage] Forwarded to target=${targetId}`);
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

    const active = workspaceManager.getActive();
    if (!active) return;
    const currentWidth = active.navSideWidth ?? getDefaultNavSideWidth();
    workspaceManager.update(active.id, { navSideWidth: clampNavSideWidth(currentWidth + deltaX) });
    updateLayout();
  });

  ipcMain.on(IPC.NAVSIDE_RESIZE_END, () => {
    navResizeDragging = false;
  });

  // ── NoteFile 操作 ──

  ipcMain.handle(IPC.NOTE_CREATE, async (_event, title?: string) => {
    if (!isDBReady()) return null;
    const note = await noteStore.create(title);
    activityStore.log('note.create', note.id);
    broadcastNoteList(getMainWindow());
    return note;
  });

  ipcMain.handle(IPC.NOTE_SAVE, async (_event, id: string, docContent: unknown[], title: string) => {
    if (!isDBReady()) return;
    await noteStore.save(id, docContent, title);
    activityStore.log('note.save', id);
    broadcastNoteList(getMainWindow());
  });

  ipcMain.handle(IPC.NOTE_LOAD, async (_event, id: string) => {
    if (!isDBReady()) return null;
    activityStore.log('note.open', id);
    return noteStore.get(id);
  });

  ipcMain.handle(IPC.NOTE_DELETE, async (_event, id: string) => {
    if (!isDBReady()) return;
    await noteStore.delete(id);
    activityStore.log('note.delete', id);
    broadcastNoteList(getMainWindow());
  });

  ipcMain.handle(IPC.NOTE_RENAME, async (_event, id: string, title: string) => {
    if (!isDBReady()) return;
    await noteStore.rename(id, title);
    broadcastNoteList(getMainWindow());

    // 通知 NoteView 同步 noteTitle（如果该笔记正在编辑器中打开）
    const mainWindow = getMainWindow();
    if (mainWindow) {
      for (const child of mainWindow.contentView.children) {
        if ('webContents' in child) {
          (child as any).webContents.send(IPC.NOTE_TITLE_CHANGED, { noteId: id, title });
        }
      }
    }
  });

  ipcMain.handle(IPC.NOTE_LIST, async () => {
    if (!isDBReady()) return [];
    return noteStore.list();
  });

  // DB 就绪状态查询（防止 renderer 在 db:ready 事件之后加载时错过事件）
  ipcMain.handle(IPC.IS_DB_READY, () => {
    return isDBReady();
  });

  // NoteView 报告当前打开的笔记 → 更新 Workspace 状态 + 自动更新 label
  ipcMain.handle(IPC.SET_ACTIVE_NOTE, (_event, noteId: string | null, noteTitle?: string) => {
    const active = workspaceManager.getActive();
    if (active) {
      const updates: Partial<import('../../shared/types').WorkspaceState> = { activeNoteId: noteId };
      // 自动更新 label（如果不是用户自定义的）
      if (!active.customLabel && noteTitle) {
        updates.label = noteTitle;
      }
      workspaceManager.update(active.id, updates);
      broadcastWorkspaceState(getMainWindow());
    }
  });

  // NavSide 报告展开的文件夹 → 更新 Workspace 状态
  ipcMain.handle(IPC.SET_EXPANDED_FOLDERS, (_event, folderIds: string[]) => {
    const active = workspaceManager.getActive();
    if (active) {
      workspaceManager.update(active.id, { expandedFolders: folderIds });
    }
  });

  // 笔记移动到文件夹
  ipcMain.handle(IPC.NOTE_MOVE_TO_FOLDER, async (_event, noteId: string, folderId: string | null) => {
    if (!isDBReady()) return;
    await noteStore.moveToFolder(noteId, folderId);
    broadcastNoteList(getMainWindow());
  });

  // ── Thought 操作 ──

  ipcMain.handle(IPC.THOUGHT_CREATE, async (_event, thought: any) => {
    if (!isDBReady()) return null;
    const record = await thoughtStore.create(thought);
    activityStore.log('thought.create', record.id);
    return record;
  });

  ipcMain.handle(IPC.THOUGHT_SAVE, async (_event, id: string, updates: any) => {
    if (!isDBReady()) return;
    await thoughtStore.save(id, updates);
  });

  ipcMain.handle(IPC.THOUGHT_LOAD, async (_event, id: string) => {
    if (!isDBReady()) return null;
    return thoughtStore.get(id);
  });

  ipcMain.handle(IPC.THOUGHT_DELETE, async (_event, id: string) => {
    if (!isDBReady()) return;
    await thoughtStore.delete(id);
    activityStore.log('thought.delete', id);
  });

  ipcMain.handle(IPC.THOUGHT_LIST_BY_NOTE, async (_event, noteId: string) => {
    if (!isDBReady()) return [];
    return thoughtStore.listByNote(noteId);
  });

  ipcMain.handle(IPC.THOUGHT_RELATE, async (_event, noteId: string, thoughtId: string, edge: any) => {
    if (!isDBReady()) return;
    await graphStore.relateNoteToThought(noteId, thoughtId, edge);
  });

  ipcMain.handle(IPC.THOUGHT_UNRELATE, async (_event, noteId: string, thoughtId: string) => {
    if (!isDBReady()) return;
    await graphStore.removeNoteToThought(noteId, thoughtId);
  });

  // ── Folder 操作 ──

  ipcMain.handle(IPC.FOLDER_CREATE, async (_event, title: string, parentId?: string | null) => {
    if (!isDBReady()) return null;
    const folder = await folderStore.create(title, parentId);
    broadcastContentTree(getMainWindow());
    return folder;
  });

  ipcMain.handle(IPC.FOLDER_RENAME, async (_event, id: string, title: string) => {
    if (!isDBReady()) return;
    await folderStore.rename(id, title);
    broadcastContentTree(getMainWindow());
  });

  ipcMain.handle(IPC.FOLDER_DELETE, async (_event, id: string) => {
    if (!isDBReady()) return;
    await folderStore.delete(id);
    broadcastContentTree(getMainWindow());
  });

  ipcMain.handle(IPC.FOLDER_MOVE, async (_event, id: string, parentId: string | null) => {
    if (!isDBReady()) return;
    await folderStore.move(id, parentId);
    broadcastContentTree(getMainWindow());
  });

  ipcMain.handle(IPC.FOLDER_LIST, async () => {
    if (!isDBReady()) return [];
    return folderStore.list();
  });

  // NavSide 请求打开笔记 → 广播给所有 View（NoteView 会响应）
  ipcMain.handle(IPC.NOTE_OPEN_IN_EDITOR, async (_event, noteId: string) => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return;
    // 广播给所有 WebContentsView
    for (const view of mainWindow.contentView.children) {
      if ('webContents' in view) {
        (view as any).webContents.send(IPC.NOTE_OPEN_IN_EDITOR, noteId);
      }
    }
  });

  // ── NavSide 注册制 ──

  ipcMain.handle(IPC.NAVSIDE_GET_REGISTRATION, (_event, workModeId: string) => {
    return navSideRegistry.get(workModeId) ?? null;
  });

  // ── eBook 书架操作 ──

  ipcMain.handle(IPC.EBOOK_BOOKSHELF_LIST, async () => {
    return bookshelfStore.list();
  });

  // 弹文件对话框（只选文件，不导入）
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

  // 按指定模式导入（managed 或 link）
  ipcMain.handle(IPC.EBOOK_BOOKSHELF_ADD, async (_event, filePath: string, fileType: string, storage: 'managed' | 'link') => {
    const ft = fileType as 'pdf' | 'epub' | 'djvu' | 'cbz';
    const entry = storage === 'managed'
      ? await bookshelfStore.addManaged(filePath, ft)
      : await bookshelfStore.addLinked(filePath, ft);

    broadcastBookshelfChanged(getMainWindow());

    // 加载文件并通知 EBookView
    await loadEBook(entry.filePath);
    broadcastEBookLoaded(getMainWindow(), {
      bookId: entry.id,
      fileName: entry.displayName,
      fileType: entry.fileType,
    });

    return entry;
  });

  ipcMain.handle(IPC.EBOOK_BOOKSHELF_OPEN, async (_event, id: string) => {
    const entry = await bookshelfStore.get(id);
    if (!entry) return { success: false, error: 'Entry not found' };

    const exists = await bookshelfStore.checkExists(id);
    if (!exists) return { success: false, error: 'File not found' };

    await bookshelfStore.updateOpened(id);
    await loadEBook(entry.filePath);
    broadcastEBookLoaded(getMainWindow(), {
      bookId: entry.id,
      fileName: entry.displayName,
      fileType: entry.fileType,
      lastPosition: entry.lastPosition,
    });
    broadcastBookshelfChanged(getMainWindow());

    return { success: true };
  });

  ipcMain.handle(IPC.EBOOK_BOOKSHELF_REMOVE, async (_event, id: string) => {
    await bookshelfStore.remove(id);
    broadcastBookshelfChanged(getMainWindow());
  });

  ipcMain.handle(IPC.EBOOK_BOOKSHELF_RENAME, async (_event, id: string, displayName: string) => {
    await bookshelfStore.rename(id, displayName);
    broadcastBookshelfChanged(getMainWindow());
  });

  ipcMain.handle(IPC.EBOOK_BOOKSHELF_MOVE, async (_event, id: string, folderId: string | null) => {
    await bookshelfStore.moveToFolder(id, folderId);
    broadcastBookshelfChanged(getMainWindow());
  });

  // ── eBook 文件夹操作 ──

  ipcMain.handle(IPC.EBOOK_FOLDER_LIST, async () => {
    return bookshelfStore.folderList();
  });

  ipcMain.handle(IPC.EBOOK_FOLDER_CREATE, async (_event, title: string, parentId?: string | null) => {
    const folder = await bookshelfStore.folderCreate(title, parentId);
    broadcastBookshelfChanged(getMainWindow());
    return folder;
  });

  ipcMain.handle(IPC.EBOOK_FOLDER_RENAME, async (_event, id: string, title: string) => {
    await bookshelfStore.folderRename(id, title);
    broadcastBookshelfChanged(getMainWindow());
  });

  ipcMain.handle(IPC.EBOOK_FOLDER_DELETE, async (_event, id: string) => {
    await bookshelfStore.folderDelete(id);
    broadcastBookshelfChanged(getMainWindow());
  });

  ipcMain.handle(IPC.EBOOK_FOLDER_MOVE, async (_event, id: string, parentId: string | null) => {
    await bookshelfStore.folderMove(id, parentId);
    broadcastBookshelfChanged(getMainWindow());
  });

  // ── eBook 数据传输 ──

  ipcMain.handle(IPC.EBOOK_GET_DATA, () => {
    return getEBookData();
  });

  ipcMain.handle(IPC.EBOOK_CLOSE, () => {
    closeEBook();
  });

  // EBookView 启动时请求恢复上次打开的电子书
  ipcMain.handle(IPC.EBOOK_RESTORE, async () => {
    const active = workspaceManager.getActive();
    if (!active?.activeBookId) return null;

    const entry = await bookshelfStore.get(active.activeBookId);
    if (!entry) return null;

    const exists = await bookshelfStore.checkExists(entry.id);
    if (!exists) return null;

    await loadEBook(entry.filePath);
    return {
      bookId: entry.id,
      fileName: entry.displayName,
      fileType: entry.fileType,
      lastPosition: entry.lastPosition,
    };
  });

  // ── eBook 书签 ──

  ipcMain.handle(IPC.EBOOK_BOOKMARK_TOGGLE, async (_event, bookId: string, page: number) => {
    return bookshelfStore.toggleBookmark(bookId, page);
  });

  ipcMain.handle(IPC.EBOOK_BOOKMARK_LIST, async (_event, bookId: string) => {
    return bookshelfStore.getBookmarks(bookId);
  });

  // ── eBook CFI 书签（EPUB）──

  ipcMain.handle(IPC.EBOOK_CFI_BOOKMARK_ADD, async (_event, bookId: string, cfi: string, label: string) => {
    return bookshelfStore.addCFIBookmark(bookId, cfi, label);
  });

  ipcMain.handle(IPC.EBOOK_CFI_BOOKMARK_REMOVE, async (_event, bookId: string, cfi: string) => {
    return bookshelfStore.removeCFIBookmark(bookId, cfi);
  });

  ipcMain.handle(IPC.EBOOK_CFI_BOOKMARK_LIST, async (_event, bookId: string) => {
    return bookshelfStore.getCFIBookmarks(bookId);
  });

  // ── eBook 标注 ──

  ipcMain.handle(IPC.EBOOK_ANNOTATION_LIST, async (_event, bookId: string) => {
    return annotationStore.list(bookId);
  });

  ipcMain.handle(IPC.EBOOK_ANNOTATION_ADD, async (_event, bookId: string, ann: any) => {
    return annotationStore.add(bookId, ann);
  });

  ipcMain.handle(IPC.EBOOK_ANNOTATION_REMOVE, async (_event, bookId: string, annotationId: string) => {
    await annotationStore.remove(bookId, annotationId);
  });

  // NavSide 保存书架文件夹展开状态
  ipcMain.handle(IPC.EBOOK_SET_EXPANDED_FOLDERS, (_event, folderIds: string[]) => {
    const active = workspaceManager.getActive();
    if (active) {
      workspaceManager.update(active.id, { ebookExpandedFolders: folderIds });
    }
  });

  // EBookView 报告当前打开的电子书
  ipcMain.handle(IPC.EBOOK_SET_ACTIVE_BOOK, (_event, bookId: string | null) => {
    const active = workspaceManager.getActive();
    if (active) {
      workspaceManager.update(active.id, { activeBookId: bookId });
      broadcastWorkspaceState(getMainWindow());
    }
  });

  // EBookView 保存阅读进度
  ipcMain.handle(IPC.EBOOK_SAVE_PROGRESS, async (_event, bookId: string, position: { page?: number; scale?: number; fitWidth?: boolean; cfi?: string }) => {
    await bookshelfStore.updateProgress(bookId, position);
  });

  // ── 文件保存对话框 ──
  ipcMain.handle(IPC.FILE_SAVE_DIALOG, async (_event, options: {
    defaultName: string;
    data: string;         // base64 编码的文件内容
    filters?: { name: string; extensions: string[] }[];
  }) => {
    const { dialog } = await import('electron');
    const { writeFile } = await import('fs/promises');
    const mainWindow = getMainWindow();
    const result = await dialog.showSaveDialog(mainWindow as any, {
      defaultPath: options.defaultName,
      filters: options.filters || [{ name: 'All Files', extensions: ['*'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const buffer = Buffer.from(options.data, 'base64');
    await writeFile(result.filePath, buffer);
    return { canceled: false, filePath: result.filePath };
  });

  // ── Web Translate ──

  ipcMain.handle(IPC.WEB_TRANSLATE_FETCH_ELEMENT_JS, async () => {
    try {
      const { net } = await import('electron');
      const resp = await net.fetch(
        'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit',
      );
      if (!resp.ok) return null;
      return await resp.text();
    } catch {
      return null;
    }
  });

  // ── 学习模块 ──

  ipcMain.handle(IPC.LEARNING_LOOKUP, (_e, word: string) =>
    lookupWord(word),
  );

  ipcMain.handle(IPC.LEARNING_TRANSLATE, (_e, text: string, targetLang?: string) =>
    googleTranslate(text, targetLang || 'zh-CN'),
  );

  ipcMain.handle(IPC.LEARNING_TTS, (_e, text: string, lang: string) =>
    googleTTS(text, lang),
  );

  ipcMain.handle(IPC.LEARNING_VOCAB_ADD, async (_e, word: string, definition: string, context?: string, phonetic?: string) => {
    const entry = await vocabStore.add(word, definition, context, phonetic);
    broadcastVocabChanged(getMainWindow());
    return entry;
  });

  ipcMain.handle(IPC.LEARNING_VOCAB_REMOVE, async (_e, id: string) => {
    await vocabStore.remove(id);
    broadcastVocabChanged(getMainWindow());
  });

  ipcMain.handle(IPC.LEARNING_VOCAB_LIST, () =>
    vocabStore.list(),
  );

  // ── 媒体操作 ──

  ipcMain.handle(IPC.MEDIA_DOWNLOAD, async (_e, url: string, mediaType: 'video' | 'audio') => {
    const type = mediaType === 'video' ? 'audio' : mediaType; // video 暂不支持，降级为 audio
    return mediaStore.download(url, type as 'audio' | 'image');
  });

  // MEDIA_PUT_BASE64: persist a base64/data-URL payload into the media
  // store and return a `media://...` URL. Renderer uses this when the
  // user uploads a file via a fileBlock/externalRef placeholder — we
  // don't want to embed the base64 into note JSON.
  ipcMain.handle(IPC.MEDIA_PUT_BASE64, async (_e, params: { input: string; mimeType?: string; filename?: string }) => {
    const { mediaSurrealStore } = await import('../media/media-surreal-store');
    return mediaSurrealStore.putBase64(params.input, params.mimeType, params.filename);
  });

  // MEDIA_RESOLVE_PATH: turn `media://bucket/name.ext` into the real disk
  // path at `{userData}/krig-data/media/bucket/name.ext`. The media://
  // protocol is only registered in Electron's renderer — the OS (and
  // therefore shell.openExternal) doesn't know it, so we resolve to a
  // filesystem path whenever we need shell.openPath / showItemInFolder.
  ipcMain.handle(IPC.MEDIA_RESOLVE_PATH, async (_e, mediaUrl: string) => {
    try {
      const { app } = await import('electron');
      const path = await import('node:path');
      const fs = await import('node:fs');
      if (!mediaUrl.startsWith('media://')) return { success: false, error: 'not a media:// URL' };
      const rel = mediaUrl.slice('media://'.length);
      const abs = path.join(app.getPath('userData'), 'krig-data', 'media', rel);
      if (!fs.existsSync(abs)) return { success: false, error: 'file not found', path: abs };
      return { success: true, path: abs };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // MEDIA_OPEN_PATH: open a local file with the system default handler.
  // Use after MEDIA_RESOLVE_PATH (or with any pre-resolved absolute path).
  ipcMain.handle(IPC.MEDIA_OPEN_PATH, async (_e, filePath: string) => {
    const result = await shell.openPath(filePath);
    // shell.openPath returns '' on success, error string on failure.
    return { success: !result, error: result || undefined };
  });

  ipcMain.handle(IPC.MEDIA_OPEN_EXTERNAL, async (_e, url: string) => {
    await shell.openExternal(url);
    return { success: true };
  });

  // MD_TO_PM_NODES: convert a Markdown string to ProseMirror-node JSON
  // blocks. Used by the renderer's smart-paste plugin after turning the
  // clipboard's text/html into Markdown.
  ipcMain.handle(IPC.MD_TO_PM_NODES, async (_e, markdown: string) => {
    try {
      const { markdownToProseMirror } = await import('../storage/md-to-pm');
      return await markdownToProseMirror(markdown);
    } catch (err) {
      console.warn('[MD_TO_PM_NODES] failed:', err);
      return [];
    }
  });

  ipcMain.handle(IPC.SHOW_ITEM_IN_FOLDER, (_e, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  // ── AI Workflow ──

  // AI_ASK: Orchestrator / background mode (BackgroundAIWebview)
  ipcMain.handle(IPC.AI_ASK, async (_event, params: {
    serviceId: string;
    prompt: string;
    noteId?: string;
    thoughtId?: string;
  }) => {
    try {
      const { askAI } = await import('../../plugins/web-bridge/capabilities/ai-interaction');
      const result = await askAI(params.serviceId as any, params.prompt);
      return result;
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // AI_ASK_VISIBLE: User-facing mode — use Right Slot WebView
  // Opens Right Slot with WebView, waits for renderer to load,
  // then sends AI_INJECT_AND_SEND to the renderer.
  ipcMain.handle(IPC.AI_ASK_VISIBLE, async (_event, params: {
    serviceId: string;
    prompt: string;
    noteId: string;
    thoughtId: string;
  }) => {
    try {
      console.log('[AI_ASK_VISIBLE] Starting...', { serviceId: params.serviceId, promptLen: params.prompt.length });

      const mainWindow = getMainWindow();
      if (!mainWindow) return { success: false, error: 'No main window' };

      // 1. Open Right Slot with AI WebView (ai-web variant)
      const rightView = openRightSlot('ai-web');
      console.log('[AI_ASK_VISIBLE] Step 1: openRightSlot result:', rightView ? 'OK' : 'null (toggle?)');
      if (!rightView) {
        const retryView = openRightSlot('ai-web');
        console.log('[AI_ASK_VISIBLE] Step 1 retry:', retryView ? 'OK' : 'FAILED');
        if (!retryView) return { success: false, error: 'Failed to open Right Slot' };
      }

      // 2. Find the Right Slot's webContents
      const rightSlotIds = getActiveViewWebContentsIds();
      console.log('[AI_ASK_VISIBLE] Step 2: rightSlotIds =', rightSlotIds);
      if (!rightSlotIds || !rightSlotIds.rightId) {
        return { success: false, error: 'Right Slot not open after creation' };
      }

      const rightWC = (mainWindow as any).contentView.children.find(
        (v: any) => v.webContents?.id === rightSlotIds.rightId
      )?.webContents;

      if (!rightWC) {
        console.log('[AI_ASK_VISIBLE] Step 2: webContents NOT found for rightId =', rightSlotIds.rightId);
        return { success: false, error: 'Right Slot webContents not found' };
      }
      console.log('[AI_ASK_VISIBLE] Step 2: webContents found, id =', rightWC.id);

      // 3. Wait for the renderer to finish loading
      console.log('[AI_ASK_VISIBLE] Step 3: Waiting for renderer load... isLoading =', rightWC.isLoading());
      await new Promise<void>((resolve) => {
        if (!rightWC.isLoading()) {
          setTimeout(resolve, 1500);
        } else {
          rightWC.once('did-finish-load', () => {
            setTimeout(resolve, 1500);
          });
        }
      });
      console.log('[AI_ASK_VISIBLE] Step 3: Renderer ready, sending AI_INJECT_AND_SEND...');

      // 4. Send AI request to the Right Slot renderer
      return new Promise((resolve) => {
        const responseChannel = `ai:response:${params.thoughtId}`;
        let resolved = false;

        const listener = async (_e: any, result: any) => {
          if (resolved) return;
          resolved = true;
          ipcMain.removeListener(responseChannel, listener);
          console.log('[AI_ASK_VISIBLE] Step 4: Got response from renderer:', { success: result?.success, mdLen: result?.markdown?.length ?? 0, error: result?.error });

          // Parse markdown → Atoms and save to ThoughtStore
          if (result?.success && result?.markdown) {
            try {
              const { ResultParser } = await import('../../plugins/web-bridge/pipeline/result-parser');
              const { createAtomsFromExtracted } = await import('../../plugins/web-bridge/pipeline/content-to-atoms');

              console.log('[AI_ASK_VISIBLE] Parsing markdown, length:', result.markdown.length);
              console.log('[AI_ASK_VISIBLE] Markdown preview:', result.markdown.slice(0, 200));

              const parser = new ResultParser();
              const blocks = parser.parse(result.markdown);
              console.log('[AI_ASK_VISIBLE] Parsed blocks:', blocks.length, blocks.map((b: any) => b.type));

              const atoms = createAtomsFromExtracted(blocks);
              console.log('[AI_ASK_VISIBLE] Created atoms:', atoms.length, atoms.map((a: any) => `${a.type}(${a.id?.slice(0,8)})`));

              // Remove the document root and noteTitle — Thought only needs content atoms
              const contentAtoms = atoms.filter((a: any) => a.type !== 'document' && a.type !== 'noteTitle');
              console.log('[AI_ASK_VISIBLE] Content atoms (after filter):', contentAtoms.length);

              // Fix parentId: Thought's atomsToDoc expects top-level atoms without parentId,
              // or with parentId pointing to a root document.
              // Since we removed the document atom, clear parentId of top-level atoms.
              const docAtom = atoms.find((a: any) => a.type === 'document');
              const docId = docAtom?.id;
              for (const atom of contentAtoms) {
                if (atom.parentId === docId) {
                  atom.parentId = undefined;
                }
              }

              console.log('[AI_ASK_VISIBLE] First content atom:', JSON.stringify(contentAtoms[0])?.slice(0, 300));

              await thoughtStore.save(params.thoughtId, { doc_content: contentAtoms });
              console.log('[AI_ASK_VISIBLE] Saved', contentAtoms.length, 'atoms to ThoughtStore');
            } catch (parseErr) {
              console.error('[AI_ASK_VISIBLE] Failed to parse/save AI response:', parseErr);
              // Fallback: save raw markdown as single paragraph
              await thoughtStore.save(params.thoughtId, {
                doc_content: [{
                  id: `atom-${Date.now()}`,
                  type: 'paragraph',
                  content: { children: [{ type: 'text', text: result.markdown }] },
                  meta: { createdAt: Date.now(), updatedAt: Date.now(), dirty: false },
                }],
              });
              console.log('[AI_ASK_VISIBLE] Fallback: saved raw markdown as single paragraph');
            }
          } else {
            console.log('[AI_ASK_VISIBLE] No markdown to parse:', { success: result?.success, hasMarkdown: !!result?.markdown });
          }

          resolve(result);
        };

        ipcMain.on(responseChannel, listener);

        console.log('[AI_ASK_VISIBLE] Step 4: Sending IPC.AI_INJECT_AND_SEND to rightWC id =', rightWC.id);
        rightWC.send(IPC.AI_INJECT_AND_SEND, {
          ...params,
          responseChannel,
        });

        // Timeout after 90 seconds
        setTimeout(() => {
          if (resolved) return;
          resolved = true;
          ipcMain.removeListener(responseChannel, listener);
          console.log('[AI_ASK_VISIBLE] Step 4: TIMEOUT after 90s');
          resolve({ success: false, error: 'AI response timed out (90s)' });
        }, 90_000);
      });
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.AI_STATUS, async () => {
    const { backgroundAI } = await import('../../plugins/web-bridge/capabilities/background-webview');
    return backgroundAI.getStatus();
  });

  // AI_READ_CLIPBOARD: Read system clipboard text (for Copy button extraction)
  ipcMain.handle(IPC.AI_READ_CLIPBOARD, async () => {
    const { clipboard } = await import('electron');
    return clipboard.readText();
  });

  // WB_CAPTURE_DOWNLOAD_ONCE: Arm a one-shot will-download handler on the
  // sender's guest webContents session. The NEXT download triggered on
  // that session is intercepted: saved to a temp path, read into memory,
  // deleted, and returned to the caller as raw bytes (base64).
  //
  // Returning base64 (not a UTF-8 string) preserves original bytes — critical
  // because Claude's SVG downloads have a latin1/utf-8 encoding bug that
  // callers need to reverse; if we decode as UTF-8 here, the original bytes
  // are lost and the bug can't be fixed. Binary downloads (PNG) also need
  // byte-exact preservation.
  ipcMain.handle(IPC.WB_CAPTURE_DOWNLOAD_ONCE, async (event, timeoutMs?: number) => {
    try {
      const { getGuest } = await import('../../plugins/web-bridge/infrastructure/guest-registry');
      const fs = await import('node:fs');
      const path = await import('node:path');
      const os = await import('node:os');

      const guest = getGuest(event.sender.id);
      if (!guest) return { success: false, error: 'no guest for sender' };
      const session = guest.session;

      return await new Promise<{
        success: boolean;
        filename?: string;
        mimeType?: string;
        /** base64-encoded raw bytes of the downloaded file */
        contentBase64?: string;
        byteLength?: number;
        error?: string;
      }>((resolve) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krig-artifact-'));
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          session.removeListener('will-download', listener);
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
          resolve({ success: false, error: 'timeout waiting for download' });
        }, timeoutMs ?? 10_000);

        const listener = (_ev: Electron.Event, item: Electron.DownloadItem) => {
          // One-shot: detach immediately so later downloads behave normally.
          session.removeListener('will-download', listener);

          const filename = item.getFilename();
          const mimeType = item.getMimeType();
          const savePath = path.join(tmpDir, filename);
          item.setSavePath(savePath);

          item.on('done', (_e, state) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (state === 'completed') {
              try {
                const buf = fs.readFileSync(savePath);
                resolve({
                  success: true,
                  filename,
                  mimeType,
                  contentBase64: buf.toString('base64'),
                  byteLength: buf.length,
                });
              } catch (err) {
                resolve({ success: false, error: 'read failed: ' + String(err) });
              }
            } else {
              resolve({ success: false, error: 'download ' + state });
            }
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
          });
        };
        session.on('will-download', listener);
      });
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // WB_FETCH_BINARY: fetch a URL from the main process and return the body
  // as base64. Used to download assets that the renderer can't fetch itself
  // because of CORS (e.g. Gemini's lh3.googleusercontent.com Imagen outputs,
  // which reject cross-origin fetch and also fail img.onerror under
  // crossOrigin="anonymous"). Main-process net.fetch has no CORS.
  ipcMain.handle(IPC.WB_FETCH_BINARY, async (_event, params: {
    url: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
  }) => {
    try {
      const { net } = await import('electron');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 15_000);
      try {
        const resp = await net.fetch(params.url, {
          method: 'GET',
          headers: params.headers,
          redirect: 'follow',
          signal: controller.signal,
        });
        if (!resp.ok) return { success: false, error: `http ${resp.status}` };
        const buf = Buffer.from(await resp.arrayBuffer());
        const mimeType = resp.headers.get('content-type') || 'application/octet-stream';
        return {
          success: true,
          base64: buf.toString('base64'),
          mimeType: mimeType.split(';')[0].trim(),
          bodyLength: buf.length,
        };
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // WB_READ_CLIPBOARD_IMAGE: Read clipboard as PNG data URL.
  // Claude "Copy to clipboard" on an Artifact writes the rendered image, not source.
  ipcMain.handle(IPC.WB_READ_CLIPBOARD_IMAGE, async () => {
    const { clipboard } = await import('electron');
    const img = clipboard.readImage();
    if (img.isEmpty()) return { success: false, empty: true };
    const size = img.getSize();
    return {
      success: true,
      dataUrl: img.toDataURL(),
      width: size.width,
      height: size.height,
    };
  });

  // ── WebBridge CDP Interceptor (Debug) ──
  // Attach Chrome DevTools Protocol to the sender's guest webview and capture network responses.
  // Used to inspect Claude Artifact API traffic and any other server responses.
  let cdpInstance: import('../../plugins/web-bridge/capabilities/cdp-interceptor').CDPInterceptor | null = null;

  ipcMain.handle(IPC.WB_CDP_START, async (event, urlFilters?: string[]) => {
    try {
      const { getGuest } = await import('../../plugins/web-bridge/infrastructure/guest-registry');
      const { CDPInterceptor } = await import('../../plugins/web-bridge/capabilities/cdp-interceptor');

      const senderId = event.sender.id;
      const guest = getGuest(senderId);
      if (!guest) {
        return { success: false, error: 'No guest webview found for sender ' + senderId };
      }

      // Stop previous instance if any
      if (cdpInstance) {
        cdpInstance.stop();
        cdpInstance = null;
      }

      const filters = (urlFilters || []).map(f => f.startsWith('/') && f.endsWith('/') ? new RegExp(f.slice(1, -1)) : f);
      cdpInstance = new CDPInterceptor(guest, {
        urlFilters: filters,
        maxCacheSize: 200,
        captureBodies: true,
      });
      const ok = cdpInstance.start();
      return {
        success: ok,
        guestUrl: guest.getURL(),
        guestId: guest.id,
        filters: urlFilters || [],
      };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // WB_SEND_MOUSE: synthesize native mouse events into the sender's guest webview
  // via CDP (Input.dispatchMouseEvent). Used to trigger Radix UI hover menus
  // (e.g. Claude Artifact "..." menu) that don't respond to JS-layer dispatchEvent.
  ipcMain.handle(IPC.WB_SEND_MOUSE, async (event, events: Array<{
    type: string; x: number; y: number;
    button?: string; buttons?: number; clickCount?: number;
  }>) => {
    try {
      const { getGuest } = await import('../../plugins/web-bridge/infrastructure/guest-registry');
      const senderId = event.sender.id;
      const guest = getGuest(senderId);
      if (!guest) return { success: false, error: 'No guest for sender ' + senderId };

      // Attach debugger if not already attached. Safe to call repeatedly;
      // if another debugger is attached we silently ignore.
      const dbg = guest.debugger;
      if (!dbg.isAttached()) {
        try { dbg.attach('1.3'); } catch (e) { /* another debugger may be attached */ }
      }

      for (const ev of events) {
        await dbg.sendCommand('Input.dispatchMouseEvent', {
          type: ev.type,
          x: ev.x,
          y: ev.y,
          button: ev.button ?? 'none',
          buttons: ev.buttons ?? 0,
          clickCount: ev.clickCount ?? 0,
          pointerType: 'mouse',
        });
      }
      return { success: true, count: events.length };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // WB_SEND_KEY: synthesize native key events into the sender's guest webview
  // via CDP (Input.dispatchKeyEvent). Used for browser-layer UI such as
  // download confirmation bubbles that aren't part of the page DOM.
  ipcMain.handle(IPC.WB_SEND_KEY, async (event, events: Array<{
    type: string;
    key: string;
    code?: string;
    windowsVirtualKeyCode?: number;
  }>) => {
    try {
      const { getGuest } = await import('../../plugins/web-bridge/infrastructure/guest-registry');
      const senderId = event.sender.id;
      const guest = getGuest(senderId);
      if (!guest) return { success: false, error: 'No guest for sender ' + senderId };

      const dbg = guest.debugger;
      if (!dbg.isAttached()) {
        try { dbg.attach('1.3'); } catch (e) { /* another debugger may be attached */ }
      }

      for (const ev of events) {
        await dbg.sendCommand('Input.dispatchKeyEvent', {
          type: ev.type,
          key: ev.key,
          code: ev.code ?? ev.key,
          windowsVirtualKeyCode: ev.windowsVirtualKeyCode ?? 0,
          nativeVirtualKeyCode: ev.windowsVirtualKeyCode ?? 0,
        });
      }
      return { success: true, count: events.length };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.WB_CDP_STOP, async () => {
    if (cdpInstance) {
      cdpInstance.stop();
      cdpInstance = null;
    }
    return { success: true };
  });

  ipcMain.handle(IPC.WB_CDP_GET_RESPONSES, async () => {
    if (!cdpInstance) return { success: false, error: 'CDP not started', responses: [] };
    const responses = cdpInstance.getResponses();
    // Return truncated body previews to avoid massive IPC payloads
    const preview = responses.map(r => ({
      requestId: r.requestId,
      url: r.url,
      statusCode: r.statusCode,
      mimeType: r.mimeType,
      bodyLength: r.body?.length ?? 0,
      bodyPreview: r.body?.slice(0, 2000) ?? null,
      timestamp: r.timestamp,
    }));
    return { success: true, count: responses.length, responses: preview };
  });

  // WB_CDP_FIND_RESPONSE: Return full bodies of captured CDP responses
  // matching a URL substring. Used by content extractors (e.g. ChatGPT)
  // that need the raw JSON / base64 payload rather than a 2KB preview.
  //
  // `urlSubstring`: case-sensitive substring match against response URL.
  // `mode`:
  //   'all'    → every match, in capture order (default)
  //   'latest' → only the most recent match
  //   'first'  → only the earliest match
  ipcMain.handle(IPC.WB_CDP_FIND_RESPONSE, async (_event, params: {
    urlSubstring: string;
    mode?: 'all' | 'latest' | 'first';
  }) => {
    if (!cdpInstance) return { success: false, error: 'CDP not started', matches: [] };
    const all = cdpInstance.getResponses().filter(r => r.url.includes(params.urlSubstring));
    let picked = all;
    if (params.mode === 'latest') picked = all.slice(-1);
    else if (params.mode === 'first') picked = all.slice(0, 1);
    return {
      success: true,
      count: picked.length,
      matches: picked.map(r => ({
        url: r.url, statusCode: r.statusCode, mimeType: r.mimeType,
        body: r.body, bodyLength: r.body?.length ?? 0, timestamp: r.timestamp,
      })),
    };
  });

  // AI_PARSE_MARKDOWN: Parse markdown → Atom[] (used by SyncNote receiver)
  ipcMain.handle(IPC.AI_PARSE_MARKDOWN, async (_event, markdown: string) => {
    try {
      const { ResultParser } = await import('../../plugins/web-bridge/pipeline/result-parser');
      const { createAtomsFromExtracted } = await import('../../plugins/web-bridge/pipeline/content-to-atoms');

      const parser = new ResultParser();
      const blocks = parser.parse(markdown);
      // Pass a title to prevent createAtomsFromExtracted from consuming the first heading
      const atoms = createAtomsFromExtracted(blocks, '__skip_title__');

      // Remove document root + noteTitle — only content atoms needed
      const docAtom = atoms.find((a: any) => a.type === 'document');
      const docId = docAtom?.id;
      const contentAtoms = atoms.filter((a: any) => a.type !== 'document' && a.type !== 'noteTitle');
      for (const atom of contentAtoms) {
        if (atom.parentId === docId) atom.parentId = undefined;
      }

      return { success: true, atoms: contentAtoms };
    } catch (err) {
      console.error('[AI_PARSE_MARKDOWN] Error:', err);
      return { success: false, error: String(err), atoms: [] };
    }
  });

  ipcMain.handle(IPC.AI_EXTRACTION_CACHE_WRITE, async (_event, payload: {
    extractionId?: string;
    stage?: string;
    serviceId?: string;
    url?: string;
    noteTitle?: string;
    msgIndex?: number;
    preview?: string;
    userMessage?: string;
    markdown?: string;
    meta?: Record<string, unknown>;
  }) => {
    try {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');

      const cacheDir = path.join(process.cwd(), 'debug', 'ai-extraction-cache');
      await fs.mkdir(cacheDir, { recursive: true });

      const extractionId = String(payload.extractionId || Date.now());
      const stage = String(payload.stage || 'snapshot');
      const serviceId = String(payload.serviceId || 'unknown');
      const safeId = extractionId.replace(/[^a-zA-Z0-9._-]/g, '_');
      const safeStage = stage.replace(/[^a-zA-Z0-9._-]/g, '_');
      const baseName = `${safeId}-${safeStage}`;

      const record = {
        extractionId,
        stage,
        serviceId,
        writtenAt: new Date().toISOString(),
        ...payload,
      };

      const jsonPath = path.join(cacheDir, `${baseName}.json`);
      await fs.writeFile(jsonPath, JSON.stringify(record, null, 2), 'utf8');

      let markdownPath: string | null = null;
      if (typeof payload.markdown === 'string') {
        markdownPath = path.join(cacheDir, `${baseName}.md`);
        await fs.writeFile(markdownPath, payload.markdown, 'utf8');
      }

      await fs.writeFile(
        path.join(cacheDir, `latest-${serviceId}.json`),
        JSON.stringify(record, null, 2),
        'utf8',
      );
      if (typeof payload.markdown === 'string') {
        await fs.writeFile(
          path.join(cacheDir, `latest-${serviceId}.md`),
          payload.markdown,
          'utf8',
        );
      }

      return { success: true, dir: cacheDir, jsonPath, markdownPath };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // AI_EXTRACT_DEBUG: Parse markdown and return stats (for debugging extraction quality)
  ipcMain.handle(IPC.AI_EXTRACT_DEBUG, async (_event, params: { markdown: string; serviceId: string }) => {
    try {
      const { ResultParser } = await import('../../plugins/web-bridge/pipeline/result-parser');
      const { createAtomsFromExtracted } = await import('../../plugins/web-bridge/pipeline/content-to-atoms');

      const parser = new ResultParser();
      const blocks = parser.parse(params.markdown);

      console.log('[AI_EXTRACT_DEBUG] Parsed blocks:', blocks.length);

      // Build detailed block info for the debug panel
      const blockDetails = blocks.map((b: any, i: number) => {
        const info: any = { index: i, type: b.type, textLength: b.text?.length ?? 0 };
        if (b.language) info.language = b.language;
        if (b.headingLevel) info.headingLevel = b.headingLevel;
        if (b.src) info.src = b.src;
        if (b.items) info.itemCount = b.items.length;
        if (b.tableRows) info.rows = b.tableRows.length;
        if (b.inlines) info.inlineCount = b.inlines.length;
        info.textPreview = b.text?.slice(0, 120) || '';
        console.log(`  [${i}] ${b.type}${b.language ? `(${b.language})` : ''}: "${info.textPreview.slice(0, 60)}"`);
        return info;
      });

      const atoms = createAtomsFromExtracted(blocks);
      const contentAtoms = atoms.filter((a: any) => a.type !== 'document' && a.type !== 'noteTitle');

      const docAtom = atoms.find((a: any) => a.type === 'document');
      const docId = docAtom?.id;
      for (const atom of contentAtoms) {
        if (atom.parentId === docId) atom.parentId = undefined;
      }

      console.log('[AI_EXTRACT_DEBUG] Content atoms:', contentAtoms.length);
      const atomDetails = contentAtoms.map((a: any, i: number) => {
        const info: any = { index: i, type: a.type, id: a.id?.slice(0, 15) };
        if (a.parentId) info.parentId = a.parentId.slice(0, 15);
        // Extract text preview from content
        const content = a.content as any;
        if (content?.children) {
          const parts = content.children.map((c: any) => {
            if (c.type === 'text') return c.text || '';
            if (c.type === 'math-inline') return `$${c.latex}$`;
            if (c.type === 'code-inline') return `\`${c.code}\``;
            if (c.type === 'link') return `[${c.children?.map((ch: any) => ch.text).join('') || ''}](${c.href})`;
            return `[${c.type}]`;
          }).join('');
          info.textPreview = parts.slice(0, 120);
          info.inlineTypes = content.children.map((c: any) => c.type);
        } else if (content?.latex) {
          info.textPreview = `[LaTeX] ${content.latex.slice(0, 60)}`;
        } else if (content?.language) {
          info.textPreview = `[Code:${content.language}]`;
        } else if (content?.src) {
          info.textPreview = `[Image] ${content.src.slice(0, 60)}`;
        }
        return info;
      });

      return {
        success: true,
        blocks: blocks.length,
        atomCount: contentAtoms.length,
        preview: JSON.stringify(contentAtoms[0]?.content).slice(0, 200),
        blockTypes: blocks.map((b: any) => b.type),
        atomTypes: contentAtoms.map((a: any) => a.type),
        blockDetails,
        atomDetails,
      };
    } catch (err) {
      console.error('[AI_EXTRACT_DEBUG] Error:', err);
      return { success: false, error: String(err) };
    }
  });

  // ── Tweet 数据获取 ──

  // ── yt-dlp ──

  ipcMain.handle(IPC.YTDLP_CHECK_STATUS, async () => {
    return ytdlpCheckStatus();
  });

  ipcMain.handle(IPC.YTDLP_INSTALL, async (event) => {
    try {
      const status = await ytdlpInstall((percent) => {
        // 发送安装进度到 renderer
        event.sender.send(IPC.YTDLP_PROGRESS, { url: '', status: 'downloading', percent });
      });
      return { success: true, status };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.YTDLP_DOWNLOAD, async (event, url: string) => {
    try {
      // 1. 先获取视频标题（用于默认文件名）
      const info = await getVideoInfo(url);
      const defaultTitle = (info?.title as string) || 'video';
      const safeTitle = defaultTitle.replace(/[/\\?%*:|"<>]/g, '_');

      // 2. 弹出保存对话框
      const mainWindow = getMainWindow();
      const dialogResult = await dialog.showSaveDialog(mainWindow as any, {
        defaultPath: `${safeTitle}.mp4`,
        filters: [
          { name: 'MP4 Video', extensions: ['mp4'] },
          { name: 'WebM Video', extensions: ['webm'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (dialogResult.canceled || !dialogResult.filePath) {
        return { url, status: 'error', percent: 0, error: 'Download canceled' };
      }

      // 3. 用用户选择的路径下载
      const result = await downloadVideo(url, (progress) => {
        event.sender.send(IPC.YTDLP_PROGRESS, progress);
      }, dialogResult.filePath);
      return result;
    } catch (err) {
      return { url, status: 'error', percent: 0, error: String(err) };
    }
  });

  ipcMain.handle(IPC.YTDLP_SAVE_SUBTITLE, (_e, videoFilePath: string, langCode: string, timestampText: string) => {
    try {
      const srtPath = saveTranslationSubtitle(videoFilePath, langCode, timestampText);
      return { success: true, path: srtPath };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.YTDLP_GET_INFO, async (_e, url: string) => {
    const info = await getVideoInfo(url);
    return info ? { success: true, info } : { success: false, error: 'Failed to get info' };
  });

  // ── YouTube 字幕 ──

  ipcMain.handle(IPC.YOUTUBE_TRANSCRIPT, async (_e, videoUrl: string) => {
    return fetchYouTubeTranscript(videoUrl);
  });

  ipcMain.handle(IPC.TWEET_FETCH_DATA, async (_e, tweetUrl: string) => {
    return fetchTweetData(tweetUrl);
  });

  ipcMain.handle(IPC.TWEET_FETCH_OEMBED, async (_e, tweetUrl: string) => {
    try {
      const encodedUrl = encodeURIComponent(tweetUrl);
      const oembedUrl = `https://publish.twitter.com/oembed?url=${encodedUrl}&theme=dark&dnt=true&omit_script=false`;
      const response = await net.fetch(oembedUrl);
      if (!response.ok) return { success: false, error: `oEmbed API returned ${response.status}` };
      const data = await response.json();
      return { success: true, html: data.html || '' };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // ── Web 书签 ──

  ipcMain.handle(IPC.WEB_BOOKMARK_LIST, async () => {
    return webBookmarkStore.list();
  });

  ipcMain.handle(IPC.WEB_BOOKMARK_ADD, async (_event, url: string, title: string, favicon?: string) => {
    return webBookmarkStore.add(url, title, favicon);
  });

  ipcMain.handle(IPC.WEB_BOOKMARK_REMOVE, async (_event, id: string) => {
    await webBookmarkStore.remove(id);
  });

  ipcMain.handle(IPC.WEB_BOOKMARK_UPDATE, async (_event, id: string, fields: { title?: string; url?: string; favicon?: string }) => {
    await webBookmarkStore.update(id, fields);
  });

  ipcMain.handle(IPC.WEB_BOOKMARK_MOVE, async (_event, id: string, folderId: string | null) => {
    await webBookmarkStore.move(id, folderId);
  });

  ipcMain.handle('web:bookmark-find-by-url', async (_event, url: string) => {
    return webBookmarkStore.findByUrl(url);
  });

  // Web 书签文件夹
  ipcMain.handle(IPC.WEB_FOLDER_CREATE, async (_event, title: string) => {
    return webBookmarkStore.folderCreate(title);
  });

  ipcMain.handle(IPC.WEB_FOLDER_RENAME, async (_event, id: string, title: string) => {
    await webBookmarkStore.folderRename(id, title);
  });

  ipcMain.handle(IPC.WEB_FOLDER_DELETE, async (_event, id: string) => {
    await webBookmarkStore.folderDelete(id);
  });

  ipcMain.handle(IPC.WEB_FOLDER_LIST, async () => {
    return webBookmarkStore.folderList();
  });

  // Web 浏览历史
  ipcMain.handle(IPC.WEB_HISTORY_ADD, async (_event, url: string, title: string, favicon?: string) => {
    return webHistoryStore.add(url, title, favicon);
  });

  ipcMain.handle(IPC.WEB_HISTORY_LIST, async (_event, limit?: number) => {
    return webHistoryStore.list(limit);
  });

  ipcMain.handle(IPC.WEB_HISTORY_CLEAR, async () => {
    await webHistoryStore.clear();
  });

  // ── PDF Extraction (Platform) ──

  ipcMain.handle(IPC.EXTRACTION_OPEN, async () => {
    console.log('[Extraction] EXTRACTION_OPEN handler triggered');

    // 1. 打开 ExtractionView 到 Right Slot（加载 Platform Web UI）
    openRightSlot('extraction');

    // 2. 并行上传当前 PDF 到 Platform
    const ebookData = getEBookData();
    if (!ebookData) {
      return { uploaded: false, reason: 'no-file' };
    }
    if (!ebookData.filePath.toLowerCase().endsWith('.pdf')) {
      return { uploaded: false, reason: 'not-pdf' };
    }

    // 从书架获取显示名（而非 UUID 文件名）
    const allEntries = await bookshelfStore.list();
    const entry = allEntries.find((e) => e.filePath === ebookData.filePath);
    const displayName = entry?.displayName || ebookData.fileName.replace(/\.pdf$/i, '');
    console.log('[Extraction] Uploading:', displayName, `(${ebookData.filePath})`);

    try {
      const { uploadPdfToPlatform } = await import('../extraction/upload-service');
      const result = await uploadPdfToPlatform(ebookData.filePath, displayName);

      // 上传完成后，通知 ExtractionView 导航到书籍详情页
      const mainWindow = getMainWindow();
      if (mainWindow) {
        for (const view of mainWindow.contentView.children) {
          if ('webContents' in view) {
            (view as any).webContents.send('extraction:navigate', result.md5);
          }
        }
      }

      return { uploaded: true, md5: result.md5, alreadyExists: result.alreadyExists };
    } catch (err) {
      console.error('[Extraction] Upload failed:', err);
      return { uploaded: false, reason: String(err) };
    }
  });

  ipcMain.handle(IPC.EXTRACTION_IMPORT, async (_event, data: any) => {
    try {
      const { importExtractionData } = await import('../extraction/import-service');

      // 批次格式：{ type: 'batch', chapters: [{ bookName, title, pageStart, pageEnd, pages }] }
      // 从第一个 chapter 提取 bookName
      if (data.type === 'batch' && !data.bookName && data.chapters?.[0]?.bookName) {
        data.bookName = data.chapters[0].bookName;
      }

      // 附加当前打开的 bookId（用于建立 Graph 关系）
      const active = workspaceManager.getActive();
      if (active?.activeBookId && !data.bookId) {
        data.bookId = active.activeBookId;
      }

      const result = await importExtractionData(data);

      // 广播列表变更（让 NavSide 立即刷新文件夹/笔记树）
      broadcastContentTree(getMainWindow());

      // 有新笔记时，跳转到最新导入的笔记
      if (result.noteId) {
        setPendingNoteId(result.noteId);
        openRightSlot('demo-a');
      }

      return { success: true, ...result };
    } catch (err) {
      console.error('[Extraction] Import failed:', err);
      return { success: false, error: String(err) };
    }
  });
}

/** 广播 NoteFile 列表变更 */
function broadcastNoteList(mainWindow: BaseWindow | null): void {
  if (!mainWindow) return;
  noteStore.list().then((list) => {
    for (const view of mainWindow.contentView.children) {
      if ('webContents' in view) {
        (view as any).webContents.send(IPC.NOTE_LIST_CHANGED, list);
      }
    }
  }).catch((err) => {
    console.warn('[IPC] Failed to broadcast note list:', err);
  });
}

/** 广播完整内容树（folder + note 列表同时刷新） */
function broadcastContentTree(mainWindow: BaseWindow | null): void {
  broadcastNoteList(mainWindow);
  // folder 列表也通过 NOTE_LIST_CHANGED 触发 NavSide 刷新
  // NavSide 收到后会重新 fetch folderList
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

// ═══════════════════════════════════════════════════════════
// YouTube 字幕获取（使用 youtube-transcript 库，通过 InnerTube API）
// ═══════════════════════════════════════════════════════════

async function fetchYouTubeTranscript(videoUrl: string): Promise<{
  success: boolean;
  transcript?: string;
  error?: string;
}> {
  try {
    const { fetchTranscript } = await import('youtube-transcript');
    const segments = await fetchTranscript(videoUrl);
    if (!segments || segments.length === 0) {
      return { success: false, error: 'No transcript available for this video' };
    }
    // 转为 { time, text } 格式（offset 是毫秒）
    const result = segments.map((seg: { text: string; offset: number }) => ({
      time: Math.floor(seg.offset / 1000),
      text: seg.text,
    }));
    return { success: true, transcript: JSON.stringify(result) };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ═══════════════════════════════════════════════════════════
// Tweet 数据提取
// ═══════════════════════════════════════════════════════════

/** 隐藏 BrowserWindow + DOM 提取脚本获取推文结构化数据 */
async function fetchTweetData(tweetUrl: string): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
  let win: BrowserWindow | null = null;
  try {
    win = new BrowserWindow({
      width: 800, height: 900, show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    await win.loadURL(tweetUrl);

    // 等待 Twitter SPA 渲染（轮询最多 10 秒）
    let rendered = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const hasArticle = await win.webContents.executeJavaScript(
        'document.querySelector(\'article[data-testid="tweet"]\') !== null'
      );
      if (hasArticle) { rendered = true; break; }
    }
    if (!rendered) return { success: false, error: 'Tweet page did not render in time' };

    // 执行 DOM 提取
    const data = await win.webContents.executeJavaScript(EXTRACT_TWEET_JS);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: String(err) };
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
  }
}

/** DOM 提取脚本 — 基于 data-testid 属性 */
const EXTRACT_TWEET_JS = `
(function() {
  const result = {};
  try {
    // 找到主推文 article
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    const article = articles[0];
    if (!article) return result;

    // 作者信息
    try {
      const userNameEl = article.querySelector('[data-testid="User-Name"]');
      if (userNameEl) {
        const spans = userNameEl.querySelectorAll('span');
        for (const span of spans) {
          const text = span.textContent || '';
          if (text.startsWith('@')) result.authorHandle = text;
          else if (text.length > 1 && !text.startsWith('@') && !text.includes('·')) {
            if (!result.authorName) result.authorName = text;
          }
        }
      }
    } catch {}

    // 头像
    try {
      const avatarImg = article.querySelector('[data-testid="Tweet-User-Avatar"] img');
      if (avatarImg) result.authorAvatar = avatarImg.src;
    } catch {}

    // 推文正文
    try {
      const tweetText = article.querySelector('[data-testid="tweetText"]');
      if (tweetText) {
        result.text = tweetText.textContent || '';
        result.lang = tweetText.getAttribute('lang') || '';
      }
    } catch {}

    // 时间
    try {
      const timeEl = article.querySelector('time');
      if (timeEl) result.createdAt = timeEl.getAttribute('datetime') || '';
    } catch {}

    // 图片媒体
    try {
      const photos = article.querySelectorAll('[data-testid="tweetPhoto"] img');
      if (photos.length > 0) {
        result.media = [];
        photos.forEach(img => {
          result.media.push({ type: 'image', url: img.src });
        });
      }
    } catch {}

    // 视频媒体
    try {
      const videos = article.querySelectorAll('video');
      videos.forEach(v => {
        if (!result.media) result.media = [];
        result.media.push({ type: 'video', url: v.src || '', thumbUrl: v.poster || '' });
      });
    } catch {}

    // 互动数据
    try {
      const group = article.querySelector('[role="group"]');
      if (group) {
        const buttons = group.querySelectorAll('[data-testid]');
        const metrics = {};
        buttons.forEach(btn => {
          const testId = btn.getAttribute('data-testid') || '';
          const numSpan = btn.querySelector('span[data-testid]') || btn.querySelector('span');
          const numText = numSpan ? numSpan.textContent.trim() : '';
          const num = parseMetricNumber(numText);
          if (testId.includes('reply')) metrics.replies = num;
          if (testId.includes('retweet')) metrics.retweets = num;
          if (testId.includes('like')) metrics.likes = num;
        });
        // 浏览量
        try {
          const analyticsLink = article.querySelector('a[href*="/analytics"]');
          if (analyticsLink) {
            const viewSpan = analyticsLink.querySelector('span');
            if (viewSpan) metrics.views = parseMetricNumber(viewSpan.textContent.trim());
          }
        } catch {}
        if (Object.keys(metrics).length > 0) result.metrics = metrics;
      }
    } catch {}

    // 引用推文
    try {
      const quote = article.querySelector('[data-testid="quoteTweet"]');
      if (quote) {
        const link = quote.querySelector('a[href*="/status/"]');
        if (link) result.quotedTweet = link.href;
      }
    } catch {}

    // 回复上下文
    try {
      const social = article.querySelector('[data-testid="socialContext"]');
      if (social) {
        const link = social.querySelector('a[href*="/status/"]');
        if (link) result.inReplyTo = link.href;
      }
    } catch {}

  } catch {}
  return result;

  function parseMetricNumber(s) {
    if (!s) return 0;
    s = s.replace(/,/g, '');
    if (s.endsWith('K')) return Math.round(parseFloat(s) * 1000);
    if (s.endsWith('M')) return Math.round(parseFloat(s) * 1000000);
    return parseInt(s) || 0;
  }
})()
`;

/** 广播生词本变更 */
/** 广播书架变更（→ NavSide） */
function broadcastBookshelfChanged(mainWindow: BaseWindow | null): void {
  if (!mainWindow) return;
  bookshelfStore.list().then((list) => {
    for (const view of mainWindow.contentView.children) {
      if ('webContents' in view) {
        (view as any).webContents.send(IPC.EBOOK_BOOKSHELF_CHANGED, list);
      }
    }
  }).catch((err) => {
    console.warn('[IPC] Failed to broadcast bookshelf list:', err);
  });
}

/** 通知 EBookView 文件已加载 */
function broadcastEBookLoaded(mainWindow: BaseWindow | null, info: {
  bookId: string; fileName: string; fileType: string;
  lastPosition?: { page?: number; scale?: number; fitWidth?: boolean; cfi?: string };
}): void {
  if (!mainWindow) return;
  for (const view of mainWindow.contentView.children) {
    if ('webContents' in view) {
      (view as any).webContents.send(IPC.EBOOK_LOADED, info);
    }
  }
}

function broadcastVocabChanged(mainWindow: BaseWindow | null): void {
  if (!mainWindow) return;
  vocabStore.list().then((entries) => {
    for (const view of mainWindow.contentView.children) {
      if ('webContents' in view) {
        (view as any).webContents.send(IPC.LEARNING_VOCAB_CHANGED, entries);
      }
    }
  }).catch((err) => {
    console.warn('[IPC] Failed to broadcast vocab list:', err);
  });
}
