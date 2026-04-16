import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC } from '../../shared/types';
import type { ViewMessage } from '../../shared/types';

/**
 * View preload — 通用 View 的 API
 *
 * 所有 View 插件共享此 preload，提供基础通信 + NoteFile 操作能力。
 */
contextBridge.exposeInMainWorld('viewAPI', {
  // View 间消息（双工）
  sendToOtherSlot: (message: ViewMessage) => {
    ipcRenderer.send(IPC.VIEW_MESSAGE_SEND, message);
  },

  onMessage: (callback: (message: ViewMessage) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: ViewMessage) => callback(message);
    ipcRenderer.on(IPC.VIEW_MESSAGE_RECEIVE, listener);
    return () => ipcRenderer.removeListener(IPC.VIEW_MESSAGE_RECEIVE, listener);
  },

  // Slot 操作
  openRightSlot: (workModeId: string) => ipcRenderer.invoke(IPC.SLOT_OPEN_RIGHT, workModeId),
  ensureRightSlot: (workModeId: string) => ipcRenderer.invoke(IPC.SLOT_ENSURE_RIGHT, workModeId),
  closeRightSlot: () => ipcRenderer.invoke(IPC.SLOT_CLOSE_RIGHT),
  closeSlot: () => ipcRenderer.invoke(IPC.SLOT_CLOSE),  // 关闭自己所在的 slot

  // NoteFile 操作
  noteCreate: (title?: string) => ipcRenderer.invoke(IPC.NOTE_CREATE, title),
  noteSave: (id: string, docContent: unknown[], title: string) => ipcRenderer.invoke(IPC.NOTE_SAVE, id, docContent, title),
  noteLoad: (id: string) => ipcRenderer.invoke(IPC.NOTE_LOAD, id),
  noteRename: (id: string, title: string) => ipcRenderer.invoke(IPC.NOTE_RENAME, id, title),
  noteDelete: (id: string) => ipcRenderer.invoke(IPC.NOTE_DELETE, id),
  noteList: () => ipcRenderer.invoke(IPC.NOTE_LIST),
  noteOpenInEditor: (id: string) => ipcRenderer.invoke(IPC.NOTE_OPEN_IN_EDITOR, id),
  notePendingOpen: () => ipcRenderer.invoke(IPC.NOTE_PENDING_OPEN),

  // NoteFile 列表变更监听
  onNoteListChanged: (callback: (list: unknown[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, list: unknown[]) => callback(list);
    ipcRenderer.on(IPC.NOTE_LIST_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.NOTE_LIST_CHANGED, listener);
  },

  // NoteFile 打开事件（从 NavSide 路由过来）
  onNoteOpenInEditor: (callback: (noteId: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, noteId: string) => callback(noteId);
    ipcRenderer.on(IPC.NOTE_OPEN_IN_EDITOR, listener);
    return () => ipcRenderer.removeListener(IPC.NOTE_OPEN_IN_EDITOR, listener);
  },

  // SurrealDB 就绪查询（防止错过 db:ready 事件）
  isDBReady: () => ipcRenderer.invoke(IPC.IS_DB_READY),

  // SurrealDB 就绪监听
  onDBReady: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(IPC.DB_READY, listener);
    return () => ipcRenderer.removeListener(IPC.DB_READY, listener);
  },

  // 笔记标题变更（NavSide 重命名 → 同步到编辑器 noteTitle）
  onNoteTitleChanged: (callback: (data: { noteId: string; title: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { noteId: string; title: string }) => callback(data);
    ipcRenderer.on(IPC.NOTE_TITLE_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.NOTE_TITLE_CHANGED, listener);
  },

  // Workspace 状态同步
  setActiveNote: (noteId: string | null, noteTitle?: string) => ipcRenderer.invoke(IPC.SET_ACTIVE_NOTE, noteId, noteTitle),
  getActiveNoteId: async (): Promise<string | null> => {
    const data = await ipcRenderer.invoke(IPC.WORKSPACE_LIST);
    return data?.active?.activeNoteId ?? null;
  },

  onRestoreWorkspaceState: (callback: (state: { activeNoteId: string | null }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: any) => callback(state);
    ipcRenderer.on(IPC.RESTORE_WORKSPACE_STATE, listener);
    return () => ipcRenderer.removeListener(IPC.RESTORE_WORKSPACE_STATE, listener);
  },

  // 加载测试文档
  onLoadTestDoc: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(IPC.LOAD_TEST_DOC, listener);
    return () => ipcRenderer.removeListener(IPC.LOAD_TEST_DOC, listener);
  },

  // 文件保存对话框
  fileSaveDialog: (options: { defaultName: string; data: string; filters?: { name: string; extensions: string[] }[] }) =>
    ipcRenderer.invoke(IPC.FILE_SAVE_DIALOG, options),

  // 状态监听
  onStateChanged: (callback: (state: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
    ipcRenderer.on(IPC.WORKSPACE_STATE_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.WORKSPACE_STATE_CHANGED, listener);
  },

  // Right-click events from any guest <webview> — including events
  // inside cross-origin iframes — are forwarded by main via this
  // channel. WebViewContextMenu uses it to drive its overlay so the
  // menu works just like Chrome's built-in one (everywhere, always).
  onWebviewContextMenu: (callback: (payload: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: any) => callback(payload);
    ipcRenderer.on('krig:webview-context-menu', listener);
    return () => ipcRenderer.removeListener('krig:webview-context-menu', listener);
  },

  // ── Thought 操作 ──

  thoughtCreate: (thought: any) => ipcRenderer.invoke(IPC.THOUGHT_CREATE, thought),
  thoughtSave: (id: string, updates: any) => ipcRenderer.invoke(IPC.THOUGHT_SAVE, id, updates),
  thoughtLoad: (id: string) => ipcRenderer.invoke(IPC.THOUGHT_LOAD, id),
  thoughtDelete: (id: string) => ipcRenderer.invoke(IPC.THOUGHT_DELETE, id),
  thoughtListByNote: (noteId: string) => ipcRenderer.invoke(IPC.THOUGHT_LIST_BY_NOTE, noteId),
  thoughtRelate: (noteId: string, thoughtId: string, edge: any) => ipcRenderer.invoke(IPC.THOUGHT_RELATE, noteId, thoughtId, edge),
  thoughtUnrelate: (noteId: string, thoughtId: string) => ipcRenderer.invoke(IPC.THOUGHT_UNRELATE, noteId, thoughtId),

  // ── eBook 操作 ──

  ebookBookshelfList: () => ipcRenderer.invoke(IPC.EBOOK_BOOKSHELF_LIST),
  ebookBookshelfOpen: (id: string) => ipcRenderer.invoke(IPC.EBOOK_BOOKSHELF_OPEN, id),
  ebookGetData: () => ipcRenderer.invoke(IPC.EBOOK_GET_DATA),
  ebookClose: () => ipcRenderer.invoke(IPC.EBOOK_CLOSE),

  ebookRestore: () => ipcRenderer.invoke(IPC.EBOOK_RESTORE),
  ebookBookmarkToggle: (bookId: string, page: number) => ipcRenderer.invoke(IPC.EBOOK_BOOKMARK_TOGGLE, bookId, page),
  ebookBookmarkList: (bookId: string) => ipcRenderer.invoke(IPC.EBOOK_BOOKMARK_LIST, bookId),
  ebookCFIBookmarkAdd: (bookId: string, cfi: string, label: string) => ipcRenderer.invoke(IPC.EBOOK_CFI_BOOKMARK_ADD, bookId, cfi, label),
  ebookCFIBookmarkRemove: (bookId: string, cfi: string) => ipcRenderer.invoke(IPC.EBOOK_CFI_BOOKMARK_REMOVE, bookId, cfi),
  ebookCFIBookmarkList: (bookId: string) => ipcRenderer.invoke(IPC.EBOOK_CFI_BOOKMARK_LIST, bookId),
  ebookAnnotationList: (bookId: string) => ipcRenderer.invoke(IPC.EBOOK_ANNOTATION_LIST, bookId),
  ebookAnnotationAdd: (bookId: string, ann: unknown) => ipcRenderer.invoke(IPC.EBOOK_ANNOTATION_ADD, bookId, ann),
  ebookAnnotationRemove: (bookId: string, annotationId: string) => ipcRenderer.invoke(IPC.EBOOK_ANNOTATION_REMOVE, bookId, annotationId),
  ebookSetActiveBook: (bookId: string | null) =>
    ipcRenderer.invoke(IPC.EBOOK_SET_ACTIVE_BOOK, bookId),
  ebookSaveProgress: (bookId: string, position: { page?: number; scale?: number; fitWidth?: boolean; cfi?: string }) =>
    ipcRenderer.invoke(IPC.EBOOK_SAVE_PROGRESS, bookId, position),

  onEbookLoaded: (callback: (info: { fileName: string; fileType: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, info: { fileName: string; fileType: string }) => callback(info);
    ipcRenderer.on(IPC.EBOOK_LOADED, listener);
    return () => ipcRenderer.removeListener(IPC.EBOOK_LOADED, listener);
  },

  // ── Web Translate ──

  translateFetchElementJs: () =>
    ipcRenderer.invoke(IPC.WEB_TRANSLATE_FETCH_ELEMENT_JS),

  // ── 学习模块 ──

  lookupWord: (word: string) =>
    ipcRenderer.invoke(IPC.LEARNING_LOOKUP, word),

  translateText: (text: string, targetLang?: string) =>
    ipcRenderer.invoke(IPC.LEARNING_TRANSLATE, text, targetLang),

  playTTS: (text: string, lang: string) =>
    ipcRenderer.invoke(IPC.LEARNING_TTS, text, lang),

  addVocabWord: (word: string, definition: string, context?: string, phonetic?: string) =>
    ipcRenderer.invoke(IPC.LEARNING_VOCAB_ADD, word, definition, context, phonetic),

  removeVocabWord: (id: string) =>
    ipcRenderer.invoke(IPC.LEARNING_VOCAB_REMOVE, id),

  listVocabWords: () =>
    ipcRenderer.invoke(IPC.LEARNING_VOCAB_LIST),

  onVocabChanged: (callback: (entries: unknown[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, entries: unknown[]) => callback(entries);
    ipcRenderer.on(IPC.LEARNING_VOCAB_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.LEARNING_VOCAB_CHANGED, listener);
  },

  // ── 媒体操作 ──

  downloadMedia: (url: string, mediaType: 'video' | 'audio') =>
    ipcRenderer.invoke(IPC.MEDIA_DOWNLOAD, url, mediaType),

  mediaPutBase64: (input: string, mimeType?: string, filename?: string) =>
    ipcRenderer.invoke(IPC.MEDIA_PUT_BASE64, { input, mimeType, filename }),

  mediaResolvePath: (mediaUrl: string) =>
    ipcRenderer.invoke(IPC.MEDIA_RESOLVE_PATH, mediaUrl),

  mediaOpenPath: (filePath: string) =>
    ipcRenderer.invoke(IPC.MEDIA_OPEN_PATH, filePath),

  /**
   * Resolve the absolute filesystem path of a `File` object (from
   * <input type=file> or a drop event). Electron ≥ v32 no longer
   * exposes `file.path` to renderer JS for security; the sanctioned
   * replacement is `webUtils.getPathForFile` called from preload.
   */
  getFilePath: (file: File): string => {
    try { return webUtils.getPathForFile(file); } catch { return ''; }
  },

  openExternal: (url: string) =>
    ipcRenderer.invoke(IPC.MEDIA_OPEN_EXTERNAL, url),

  markdownToPMNodes: (markdown: string) =>
    ipcRenderer.invoke(IPC.MD_TO_PM_NODES, markdown),

  showItemInFolder: (filePath: string) =>
    ipcRenderer.invoke(IPC.SHOW_ITEM_IN_FOLDER, filePath),

  // ── Tweet 数据获取 ──

  fetchTweetData: (tweetUrl: string) =>
    ipcRenderer.invoke(IPC.TWEET_FETCH_DATA, tweetUrl),

  fetchTweetOEmbed: (tweetUrl: string) =>
    ipcRenderer.invoke(IPC.TWEET_FETCH_OEMBED, tweetUrl),

  // ── YouTube 字幕 ──

  fetchYouTubeTranscript: (videoUrl: string) =>
    ipcRenderer.invoke(IPC.YOUTUBE_TRANSCRIPT, videoUrl),

  // ── yt-dlp ──

  ytdlpCheckStatus: () =>
    ipcRenderer.invoke(IPC.YTDLP_CHECK_STATUS),

  ytdlpInstall: () =>
    ipcRenderer.invoke(IPC.YTDLP_INSTALL),

  ytdlpDownload: (url: string) =>
    ipcRenderer.invoke(IPC.YTDLP_DOWNLOAD, url),

  ytdlpGetInfo: (url: string) =>
    ipcRenderer.invoke(IPC.YTDLP_GET_INFO, url),

  ytdlpSaveSubtitle: (videoFilePath: string, langCode: string, timestampText: string) =>
    ipcRenderer.invoke(IPC.YTDLP_SAVE_SUBTITLE, videoFilePath, langCode, timestampText),

  onYtdlpProgress: (callback: (progress: { url: string; status: string; percent: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: { url: string; status: string; percent: number }) => callback(progress);
    ipcRenderer.on(IPC.YTDLP_PROGRESS, listener);
    return () => ipcRenderer.removeListener(IPC.YTDLP_PROGRESS, listener);
  },

  // ── PDF Extraction ──

  extractionOpen: () =>
    ipcRenderer.invoke(IPC.EXTRACTION_OPEN),

  extractionImport: (data: unknown) =>
    ipcRenderer.invoke(IPC.EXTRACTION_IMPORT, data),

  onExtractionNavigate: (callback: (md5: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, md5: string) => callback(md5);
    ipcRenderer.on('extraction:navigate', listener);
    return () => ipcRenderer.removeListener('extraction:navigate', listener);
  },

  onExtractionImport: (callback: (data: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on('extraction:import', listener);
    return () => ipcRenderer.removeListener('extraction:import', listener);
  },

  // ── AI Workflow ──

  aiAsk: (params: { serviceId: string; prompt: string; noteId?: string; thoughtId?: string }) =>
    ipcRenderer.invoke(IPC.AI_ASK, params),

  aiAskVisible: (params: { serviceId: string; prompt: string; noteId: string; thoughtId: string }) =>
    ipcRenderer.invoke(IPC.AI_ASK_VISIBLE, params),

  aiStatus: () =>
    ipcRenderer.invoke(IPC.AI_STATUS),

  aiReadClipboard: () =>
    ipcRenderer.invoke(IPC.AI_READ_CLIPBOARD),

  aiExtractionCacheWrite: (payload: any) =>
    ipcRenderer.invoke(IPC.AI_EXTRACTION_CACHE_WRITE, payload),

  // ── WebBridge CDP 调试接口 ──
  wbCdpStart: (urlFilters?: string[]) =>
    ipcRenderer.invoke(IPC.WB_CDP_START, urlFilters),
  wbCdpStop: () =>
    ipcRenderer.invoke(IPC.WB_CDP_STOP),
  wbCdpGetResponses: () =>
    ipcRenderer.invoke(IPC.WB_CDP_GET_RESPONSES),
  wbCdpFindResponse: (params: { urlSubstring: string; mode?: 'all' | 'latest' | 'first' }) =>
    ipcRenderer.invoke(IPC.WB_CDP_FIND_RESPONSE, params),
  wbSendMouse: (events: Array<{ type: string; x: number; y: number; button?: string; buttons?: number; clickCount?: number }>) =>
    ipcRenderer.invoke(IPC.WB_SEND_MOUSE, events),
  wbSendKey: (events: Array<{ type: string; key: string; code?: string; windowsVirtualKeyCode?: number }>) =>
    ipcRenderer.invoke(IPC.WB_SEND_KEY, events),
  wbReadClipboardImage: () =>
    ipcRenderer.invoke(IPC.WB_READ_CLIPBOARD_IMAGE),
  wbCaptureDownloadOnce: (timeoutMs?: number) =>
    ipcRenderer.invoke(IPC.WB_CAPTURE_DOWNLOAD_ONCE, timeoutMs),
  wbFetchBinary: (params: { url: string; headers?: Record<string, string>; timeoutMs?: number }) =>
    ipcRenderer.invoke(IPC.WB_FETCH_BINARY, params),

  aiExtractDebug: (params: { markdown: string; serviceId: string }) =>
    ipcRenderer.invoke(IPC.AI_EXTRACT_DEBUG, params),

  aiParseMarkdown: (markdown: string) =>
    ipcRenderer.invoke(IPC.AI_PARSE_MARKDOWN, markdown),

  /** Listen for AI inject-and-send requests from main (WebView receives this) */
  onAIInjectAndSend: (callback: (params: {
    serviceId: string; prompt: string; noteId: string; thoughtId: string; responseChannel: string;
  }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, params: any) => callback(params);
    ipcRenderer.on(IPC.AI_INJECT_AND_SEND, listener);
    return () => ipcRenderer.removeListener(IPC.AI_INJECT_AND_SEND, listener);
  },

  /** Send AI response back to main */
  aiSendResponse: (channel: string, result: { success: boolean; markdown?: string; error?: string }) =>
    ipcRenderer.send(channel, result),

  // ── Web 书签（WebView 用）──

  webBookmarkAdd: (url: string, title: string, favicon?: string) =>
    ipcRenderer.invoke(IPC.WEB_BOOKMARK_ADD, url, title, favicon),
  webBookmarkRemove: (id: string) =>
    ipcRenderer.invoke(IPC.WEB_BOOKMARK_REMOVE, id),
  webBookmarkList: () =>
    ipcRenderer.invoke(IPC.WEB_BOOKMARK_LIST),
  webBookmarkFindByUrl: (url: string) =>
    ipcRenderer.invoke('web:bookmark-find-by-url', url),
  webHistoryAdd: (url: string, title: string, favicon?: string) =>
    ipcRenderer.invoke(IPC.WEB_HISTORY_ADD, url, title, favicon),
});

// Bridge: forward IPC 'note:import-json' → DOM CustomEvent (for NoteEditor)
ipcRenderer.on('note:import-json', (_event, data) => {
  window.dispatchEvent(new CustomEvent('note:import-json', { detail: data }));
});
