import { contextBridge, ipcRenderer } from 'electron';
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

  // Right Slot 操作
  openRightSlot: (workModeId: string) => ipcRenderer.invoke(IPC.SLOT_OPEN_RIGHT, workModeId),
  closeRightSlot: () => ipcRenderer.invoke(IPC.SLOT_CLOSE_RIGHT),

  // NoteFile 操作
  noteCreate: (title?: string) => ipcRenderer.invoke(IPC.NOTE_CREATE, title),
  noteSave: (id: string, docContent: unknown[], title: string) => ipcRenderer.invoke(IPC.NOTE_SAVE, id, docContent, title),
  noteLoad: (id: string) => ipcRenderer.invoke(IPC.NOTE_LOAD, id),
  noteDelete: (id: string) => ipcRenderer.invoke(IPC.NOTE_DELETE, id),
  noteList: () => ipcRenderer.invoke(IPC.NOTE_LIST),

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
});
