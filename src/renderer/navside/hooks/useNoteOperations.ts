import { useState, useEffect, useCallback, useRef } from 'react';

interface NoteListItem {
  id: string;
  title: string;
  folder_id: string | null;
  updated_at: number;
}

interface FolderRecord {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  created_at: number;
}

declare const navSideAPI: {
  switchWorkMode: (id: string) => Promise<void>;
  noteCreate: (title?: string, folderId?: string | null) => Promise<any>;
  noteDelete: (id: string) => Promise<void>;
  noteRename: (id: string, title: string) => Promise<void>;
  noteMoveToFolder: (noteId: string, folderId: string | null) => Promise<void>;
  noteOpenInEditor: (id: string) => Promise<void>;
  folderCreate: (title: string, parentId?: string | null) => Promise<any>;
  folderRename: (id: string, title: string) => Promise<void>;
  folderDelete: (id: string) => Promise<void>;
};

export interface NoteOperationsInput {
  noteList: NoteListItem[];
  folderList: FolderRecord[];
  activeNoteId: string | null;
  expandedFolders: Set<string>;
  setActiveNoteId: (id: string | null) => void;
  setExpandedFolders: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export function useNoteOperations(input: NoteOperationsInput) {
  const { noteList, folderList, activeNoteId, expandedFolders, setActiveNoteId, setExpandedFolders } = input;

  // 多选
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const lastClickedRef = useRef<string | null>(null);

  // 右键菜单
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number;
    type: 'note' | 'folder';
    id: string;
    folderId?: string | null;
    isMulti?: boolean;
  } | null>(null);

  // 重命名
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingType, setRenamingType] = useState<'note' | 'folder'>('note');
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // 右键菜单：点击空白关闭
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  // 重命名自动聚焦
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const handleSwitchMode = useCallback((id: string) => {
    navSideAPI.switchWorkMode(id);
  }, []);

  const handleCreateNote = useCallback((folderId?: string | null) => {
    navSideAPI.noteCreate(undefined, folderId).then((note: any) => {
      if (note?.id) {
        setActiveNoteId(note.id);
        navSideAPI.noteOpenInEditor(note.id);
      }
    });
  }, [setActiveNoteId]);

  const handleCreateFolder = useCallback((parentId?: string | null) => {
    navSideAPI.folderCreate('新建文件夹', parentId).then((folder: any) => {
      if (folder?.id) {
        if (parentId) setExpandedFolders((s) => new Set(s).add(parentId));
        setRenamingId(folder.id);
        setRenamingType('folder');
        setRenameValue('新建文件夹');
      }
    });
  }, [setExpandedFolders]);

  const handleActionBarClick = useCallback((actionId: string) => {
    switch (actionId) {
      case 'create-folder': handleCreateFolder(); break;
      case 'create-note': handleCreateNote(); break;
      case 'create-ebook-folder':
        window.dispatchEvent(new CustomEvent('ebook:create-folder'));
        break;
      case 'import-ebook':
        window.dispatchEvent(new CustomEvent('ebook:import'));
        break;
    }
  }, [handleCreateFolder, handleCreateNote]);

  // 构建扁平可见项列表（Shift+Click 范围选择用）
  const buildVisibleKeys = useCallback((): string[] => {
    const keys: string[] = [];
    function walk(parentId: string | null) {
      const folders = folderList.filter((f) => f.parent_id === parentId).sort((a, b) => a.sort_order - b.sort_order);
      const notes = noteList.filter((n) => n.folder_id === parentId);
      for (const folder of folders) {
        keys.push(`f:${folder.id}`);
        if (expandedFolders.has(folder.id)) walk(folder.id);
      }
      for (const note of notes) {
        keys.push(`n:${note.id}`);
      }
    }
    walk(null);
    return keys;
  }, [folderList, noteList, expandedFolders]);

  const handleItemClick = useCallback((e: React.MouseEvent, key: string, noteId?: string) => {
    e.stopPropagation();
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      setSelectedItems((s) => {
        const next = new Set(s);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
      });
      lastClickedRef.current = key;
      return;
    }
    if (e.shiftKey && lastClickedRef.current) {
      e.preventDefault();
      const keys = buildVisibleKeys();
      const fromIdx = keys.indexOf(lastClickedRef.current);
      const toIdx = keys.indexOf(key);
      if (fromIdx >= 0 && toIdx >= 0) {
        const start = Math.min(fromIdx, toIdx);
        const end = Math.max(fromIdx, toIdx);
        setSelectedItems(new Set(keys.slice(start, end + 1)));
      }
      return;
    }
    setSelectedItems(new Set());
    lastClickedRef.current = key;
    if (noteId) {
      setActiveNoteId(noteId);
      navSideAPI.noteOpenInEditor(noteId);
    }
  }, [buildVisibleKeys, setActiveNoteId]);

  const handleClickNote = useCallback((e: React.MouseEvent, noteId: string) => {
    handleItemClick(e, `n:${noteId}`, noteId);
  }, [handleItemClick]);

  const handleClickFolder = useCallback((e: React.MouseEvent, folderId: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      handleItemClick(e, `f:${folderId}`);
    } else {
      setSelectedItems(new Set());
      lastClickedRef.current = `f:${folderId}`;
      setExpandedFolders((s) => {
        const next = new Set(s);
        if (next.has(folderId)) next.delete(folderId); else next.add(folderId);
        return next;
      });
    }
  }, [handleItemClick, setExpandedFolders]);

  const toggleFolder = useCallback((folderId: string) => {
    setExpandedFolders((s) => {
      const next = new Set(s);
      if (next.has(folderId)) next.delete(folderId); else next.add(folderId);
      return next;
    });
  }, [setExpandedFolders]);

  const handleContextMenu = useCallback((e: React.MouseEvent, type: 'note' | 'folder', id: string, folderId?: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    const key = type === 'note' ? `n:${id}` : `f:${id}`;
    const isMulti = selectedItems.size > 1 && selectedItems.has(key);
    setContextMenu({ x: e.clientX, y: e.clientY, type, id, folderId, isMulti });
  }, [selectedItems]);

  const handleDelete = useCallback((type: 'note' | 'folder', id: string) => {
    setContextMenu(null);
    if (type === 'note') {
      navSideAPI.noteDelete(id);
      if (activeNoteId === id) setActiveNoteId(null);
    } else {
      navSideAPI.folderDelete(id);
    }
  }, [activeNoteId, setActiveNoteId]);

  const handleDeleteSelected = useCallback(() => {
    setContextMenu(null);
    for (const key of selectedItems) {
      const [type, id] = [key.slice(0, 1), key.slice(2)];
      if (type === 'n') {
        navSideAPI.noteDelete(id);
        if (activeNoteId === id) setActiveNoteId(null);
      } else {
        navSideAPI.folderDelete(id);
      }
    }
    setSelectedItems(new Set());
  }, [selectedItems, activeNoteId, setActiveNoteId]);

  const startRename = useCallback((type: 'note' | 'folder', id: string) => {
    setContextMenu(null);
    const item = type === 'note'
      ? noteList.find((n) => n.id === id)
      : folderList.find((f) => f.id === id);
    setRenamingId(id);
    setRenamingType(type);
    setRenameValue(item?.title || '');
  }, [noteList, folderList]);

  const commitRename = useCallback(() => {
    if (renamingId && renameValue.trim()) {
      if (renamingType === 'note') {
        navSideAPI.noteRename(renamingId, renameValue.trim());
      } else {
        navSideAPI.folderRename(renamingId, renameValue.trim());
      }
    }
    setRenamingId(null);
  }, [renamingId, renamingType, renameValue]);

  const handleMoveOut = useCallback((noteId: string) => {
    setContextMenu(null);
    navSideAPI.noteMoveToFolder(noteId, null);
  }, []);

  return {
    selectedItems, setSelectedItems,
    contextMenu, setContextMenu,
    renamingId, setRenamingId, renamingType, renameValue, setRenameValue, renameInputRef,
    handleSwitchMode, handleCreateNote, handleCreateFolder, handleActionBarClick,
    handleClickNote, handleClickFolder, toggleFolder,
    handleContextMenu, handleDelete, handleDeleteSelected,
    startRename, commitRename, handleMoveOut,
  };
}
