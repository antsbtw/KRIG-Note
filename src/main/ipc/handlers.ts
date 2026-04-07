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
  getActiveViewWebContentsIds,
  getActiveProtocol,
} from '../window/shell';
import { getNavSideWidth, setNavSideWidth } from '../slot/layout';
import { noteStore } from '../storage/note-store';
import { folderStore } from '../storage/folder-store';
import { activityStore } from '../storage/activity-store';
import { isDBReady } from '../storage/client';
import { lookupWord } from '../learning/dictionary-service';
import { googleTranslate, googleTTS } from '../learning/providers/google-translate';
import { vocabStore } from '../learning/vocabulary-store';
import { mediaStore } from '../media/media-store';
import { checkStatus as ytdlpCheckStatus, install as ytdlpInstall } from '../ytdlp/binary-manager';
import { downloadVideo, getVideoInfo, saveTranslationSubtitle } from '../ytdlp/downloader';
import { loadEBook, getEBookData, closeEBook } from '../ebook/file-loader';
import { bookshelfStore } from '../ebook/bookshelf-store';
import { navSideRegistry } from '../navside/registry';

export function registerIpcHandlers(getMainWindow: () => BaseWindow | null): void {
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

  ipcMain.handle(IPC.EBOOK_BOOKSHELF_LIST, () => {
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
      ? bookshelfStore.addManaged(filePath, ft)
      : bookshelfStore.addLinked(filePath, ft);

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
    const entry = bookshelfStore.get(id);
    if (!entry) return { success: false, error: 'Entry not found' };

    const exists = await bookshelfStore.checkExists(id);
    if (!exists) return { success: false, error: 'File not found' };

    bookshelfStore.updateOpened(id);
    await loadEBook(entry.filePath);
    broadcastEBookLoaded(getMainWindow(), {
      bookId: entry.id,
      fileName: entry.displayName,
      fileType: entry.fileType,
      lastPage: entry.lastPage,
    });
    broadcastBookshelfChanged(getMainWindow());

    return { success: true };
  });

  ipcMain.handle(IPC.EBOOK_BOOKSHELF_REMOVE, (_event, id: string) => {
    bookshelfStore.remove(id);
    broadcastBookshelfChanged(getMainWindow());
  });

  ipcMain.handle(IPC.EBOOK_BOOKSHELF_RENAME, (_event, id: string, displayName: string) => {
    bookshelfStore.rename(id, displayName);
    broadcastBookshelfChanged(getMainWindow());
  });

  ipcMain.handle(IPC.EBOOK_BOOKSHELF_MOVE, (_event, id: string, folderId: string | null) => {
    bookshelfStore.moveToFolder(id, folderId);
    broadcastBookshelfChanged(getMainWindow());
  });

  // ── eBook 文件夹操作 ──

  ipcMain.handle(IPC.EBOOK_FOLDER_LIST, () => {
    return bookshelfStore.folderList();
  });

  ipcMain.handle(IPC.EBOOK_FOLDER_CREATE, (_event, title: string, parentId?: string | null) => {
    const folder = bookshelfStore.folderCreate(title, parentId);
    broadcastBookshelfChanged(getMainWindow());
    return folder;
  });

  ipcMain.handle(IPC.EBOOK_FOLDER_RENAME, (_event, id: string, title: string) => {
    bookshelfStore.folderRename(id, title);
    broadcastBookshelfChanged(getMainWindow());
  });

  ipcMain.handle(IPC.EBOOK_FOLDER_DELETE, (_event, id: string) => {
    bookshelfStore.folderDelete(id);
    broadcastBookshelfChanged(getMainWindow());
  });

  ipcMain.handle(IPC.EBOOK_FOLDER_MOVE, (_event, id: string, parentId: string | null) => {
    bookshelfStore.folderMove(id, parentId);
    broadcastBookshelfChanged(getMainWindow());
  });

  // ── eBook 数据传输 ──

  ipcMain.handle(IPC.EBOOK_GET_DATA, () => {
    return getEBookData();
  });

  ipcMain.handle(IPC.EBOOK_CLOSE, () => {
    closeEBook();
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
  ipcMain.handle(IPC.EBOOK_SAVE_PROGRESS, (_event, bookId: string, page: number) => {
    bookshelfStore.updateProgress(bookId, page);
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

  ipcMain.handle(IPC.MEDIA_OPEN_EXTERNAL, async (_e, url: string) => {
    await shell.openExternal(url);
    return { success: true };
  });

  ipcMain.handle(IPC.SHOW_ITEM_IN_FOLDER, (_e, filePath: string) => {
    shell.showItemInFolder(filePath);
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
  }).catch(() => {});
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
  const list = bookshelfStore.list();
  for (const view of mainWindow.contentView.children) {
    if ('webContents' in view) {
      (view as any).webContents.send(IPC.EBOOK_BOOKSHELF_CHANGED, list);
    }
  }
}

/** 通知 EBookView 文件已加载 */
function broadcastEBookLoaded(mainWindow: BaseWindow | null, info: { bookId: string; fileName: string; fileType: string; lastPage?: number }): void {
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
  }).catch(() => {});
}
