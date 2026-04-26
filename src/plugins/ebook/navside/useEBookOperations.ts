/**
 * useEBookOperations — eBook 业务操作 hook（v1.4 NavSide 重构 M4）。
 *
 * 镜像 useNoteOperations / useGraphOperations：
 * - bookList + folderList → TreeNode[] 给 FolderTree
 * - 维护选中 / 重命名 / 拖拽业务回调
 * - 提供 contextMenu / onDrop / onKey
 * - 维护 import 弹窗状态（EBook 独有）
 */
import { useState, useCallback } from 'react';
import { useActiveState } from '../../../renderer/navside/store/useActiveState';
import { activeStateStore } from '../../../renderer/navside/store/active-state-store';
import {
  useEBookSync,
  type EBookEntry,
  type EBookFolder,
} from './useEBookSync';
import type { TreeNode, FolderNode, ItemNode, ContextMenuItem } from '../../../renderer/navside/components/FolderTree';

declare const navSideAPI: {
  switchWorkMode: (id: string) => Promise<void>;
  ebookPickFile: () => Promise<{ filePath: string; fileName: string; fileType: string } | null>;
  ebookBookshelfAdd: (filePath: string, fileType: string, storage: 'managed' | 'link') => Promise<unknown>;
  ebookBookshelfOpen: (id: string) => Promise<{ success: boolean; error?: string }>;
  ebookBookshelfRemove: (id: string) => Promise<void>;
  ebookBookshelfRename: (id: string, displayName: string) => Promise<void>;
  ebookBookshelfMove: (id: string, folderId: string | null) => Promise<void>;
  ebookFolderCreate: (title: string, parentId?: string | null) => Promise<EBookFolder | null>;
  ebookFolderRename: (id: string, title: string) => Promise<void>;
  ebookFolderDelete: (id: string) => Promise<void>;
  ebookFolderMove: (id: string, parentId: string | null) => Promise<void>;
  closeRightSlot: () => Promise<void>;
};

export const FILE_ICONS: Record<string, string> = {
  pdf: '📄',
  epub: '📖',
  djvu: '📄',
  cbz: '🖼️',
};

export interface ImportModalState {
  filePath: string;
  fileName: string;
  fileType: string;
}

export function useEBookOperations() {
  const { bookList, folderList } = useEBookSync();
  const activeBookId = useActiveState((s) => s.activeBookId);
  const expandedFolders = useActiveState((s) => s.ebookExpandedFolders);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // EBook 独有：导入弹窗
  const [importModal, setImportModal] = useState<ImportModalState | null>(null);
  const [importStorage, setImportStorage] = useState<'managed' | 'link'>('managed');

  // EBook 独有：toast（打开失败提示）
  const [toast, setToast] = useState<string | null>(null);

  const expandedSet = new Set(expandedFolders);

  // ── tree id 编码：b:bookId / f:folderId ──

  const decode = (treeId: string): { type: 'book' | 'folder'; id: string } => ({
    type: treeId.startsWith('f:') ? 'folder' : 'book',
    id: treeId.slice(2),
  });

  // ── TreeNode[] ──

  const buildTreeNodes = useCallback((): TreeNode[] => {
    const buildChildren = (parentId: string | null): TreeNode[] => {
      const nodes: TreeNode[] = [];

      const folders = folderList
        .filter((f) => f.parent_id === parentId)
        .sort((a, b) => a.sort_order - b.sort_order);
      for (const f of folders) {
        const folderNode: FolderNode = {
          kind: 'folder',
          id: `f:${f.id}`,
          parentId: parentId ? `f:${parentId}` : null,
          title: f.title,
          expanded: expandedSet.has(f.id),
          children: buildChildren(f.id),
        };
        nodes.push(folderNode);
      }

      const books = bookList
        .filter((b) => b.folderId === parentId)
        .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
      for (const b of books) {
        const itemNode: ItemNode = {
          kind: 'item',
          id: `b:${b.id}`,
          parentId: parentId ? `f:${parentId}` : null,
          payload: b,
        };
        nodes.push(itemNode);
      }

      return nodes;
    };
    return buildChildren(null);
  }, [bookList, folderList, expandedSet]);

  // ── 折叠 ──

  const handleFolderToggle = useCallback((treeId: string, expand: boolean) => {
    if (!treeId.startsWith('f:')) return;
    const folderId = treeId.slice(2);
    const next = new Set(expandedFolders);
    if (expand) next.add(folderId);
    else next.delete(folderId);
    activeStateStore.setEBookExpandedFoldersLocal(Array.from(next));
  }, [expandedFolders]);

  // ── 单击 = 打开书 ──

  const handleItemClick = useCallback(async (item: ItemNode) => {
    const { type, id } = decode(item.id);
    if (type !== 'book') return;
    void navSideAPI.closeRightSlot();
    const result = await navSideAPI.ebookBookshelfOpen(id);
    if (result.success) {
      activeStateStore.setActiveBookIdLocal(id);
      return;
    }
    const book = bookList.find((b) => b.id === id);
    const name = book?.displayName ?? '该书';
    const reason = result.error === 'File not found'
      ? '源文件已丢失（可能被移动、删除，或备份/还原后路径失效）'
      : result.error === 'Entry not found'
        ? '书架记录不存在'
        : (result.error || '未知错误');
    setToast(`无法打开「${name}」：${reason}`);
  }, [bookList]);

  // ── 创建文件夹 ──

  const handleCreateFolder = useCallback((parentId?: string | null) => {
    void navSideAPI.ebookFolderCreate('新建文件夹', parentId).then((f) => {
      if (f?.id) {
        if (parentId) {
          const next = new Set(expandedFolders);
          next.add(parentId);
          activeStateStore.setEBookExpandedFoldersLocal(Array.from(next));
        }
        setRenamingId(`f:${f.id}`);
        setRenameValue(f.title || '新建文件夹');
      }
    });
  }, [expandedFolders]);

  // ── 导入流程 ──

  const handleImport = useCallback(async () => {
    const picked = await navSideAPI.ebookPickFile();
    if (!picked) return;
    setImportModal(picked);
    setImportStorage('managed');
  }, []);

  const handleImportConfirm = useCallback(async () => {
    if (!importModal) return;
    await navSideAPI.ebookBookshelfAdd(importModal.filePath, importModal.fileType, importStorage);
    setImportModal(null);
  }, [importModal, importStorage]);

  const cancelImport = useCallback(() => setImportModal(null), []);

  // ── 重命名 ──

  const startRename = useCallback((treeId: string) => {
    const { type, id } = decode(treeId);
    if (type === 'book') {
      const book = bookList.find((b) => b.id === id);
      if (!book) return;
      setRenamingId(treeId);
      setRenameValue(book.displayName || '');
    } else {
      const folder = folderList.find((f) => f.id === id);
      if (!folder) return;
      setRenamingId(treeId);
      setRenameValue(folder.title || '');
    }
  }, [bookList, folderList]);

  const commitRename = useCallback((treeId: string) => {
    if (!renamingId || renamingId !== treeId) return;
    const { type, id } = decode(treeId);
    const trimmed = renameValue.trim();
    if (trimmed) {
      if (type === 'book') void navSideAPI.ebookBookshelfRename(id, trimmed);
      else void navSideAPI.ebookFolderRename(id, trimmed);
    }
    setRenamingId(null);
  }, [renamingId, renameValue]);

  const cancelRename = useCallback(() => setRenamingId(null), []);

  // ── 删除 ──

  const handleDelete = useCallback((treeId: string) => {
    const { type, id } = decode(treeId);
    if (type === 'book') {
      void navSideAPI.ebookBookshelfRemove(id);
      if (activeBookId === id) activeStateStore.setActiveBookIdLocal(null);
    } else {
      void navSideAPI.ebookFolderDelete(id);
    }
  }, [activeBookId]);

  const handleDeleteSelected = useCallback(() => {
    for (const treeId of selectedIds) {
      const { type, id } = decode(treeId);
      if (type === 'book') {
        void navSideAPI.ebookBookshelfRemove(id);
        if (activeBookId === id) activeStateStore.setActiveBookIdLocal(null);
      } else {
        void navSideAPI.ebookFolderDelete(id);
      }
    }
    setSelectedIds(new Set());
  }, [selectedIds, activeBookId]);

  // ── 拖拽业务 ──

  const isDescendantFolder = useCallback((parentId: string, childId: string): boolean => {
    let current: string | null = childId;
    const visited = new Set<string>();
    while (current) {
      if (visited.has(current)) return false;
      visited.add(current);
      if (current === parentId) return true;
      const folder = folderList.find((f) => f.id === current);
      current = folder?.parent_id ?? null;
    }
    return false;
  }, [folderList]);

  const handleDrop = useCallback((draggedTreeIds: string[], targetTreeFolderId: string | null) => {
    const targetFolderId = targetTreeFolderId ? targetTreeFolderId.slice(2) : null;
    let needExpand = false;
    for (const treeId of draggedTreeIds) {
      const { type, id } = decode(treeId);
      if (type === 'book') {
        const b = bookList.find((x) => x.id === id);
        if (b && (b.folderId ?? null) !== targetFolderId) {
          void navSideAPI.ebookBookshelfMove(id, targetFolderId);
          if (targetFolderId) needExpand = true;
        }
      } else {
        const f = folderList.find((x) => x.id === id);
        if (f && f.parent_id !== targetFolderId) {
          if (!targetFolderId || !isDescendantFolder(id, targetFolderId)) {
            void navSideAPI.ebookFolderMove(id, targetFolderId);
            if (targetFolderId) needExpand = true;
          }
        }
      }
    }
    if (needExpand && targetFolderId) {
      const next = new Set(expandedFolders);
      next.add(targetFolderId);
      activeStateStore.setEBookExpandedFoldersLocal(Array.from(next));
    }
  }, [bookList, folderList, expandedFolders, isDescendantFolder]);

  // ── 右键菜单 ──

  const buildContextMenu = useCallback(
    (target: TreeNode | null): ContextMenuItem[] => {
      if (!target) {
        return [
          { id: 'new-folder', label: '新建文件夹', icon: '📁', onClick: () => handleCreateFolder(null) },
          { id: 'sep1', label: '', separator: true },
          { id: 'import', label: '导入电子书…', icon: '📥', onClick: () => void handleImport() },
        ];
      }
      const isMulti = selectedIds.size > 1 && selectedIds.has(target.id);
      const isFolder = target.kind === 'folder';
      const items: ContextMenuItem[] = [];

      if (isFolder) {
        const folderId = target.id.slice(2);
        items.push(
          { id: 'new-folder-in', label: '在此新建文件夹', icon: '📁', onClick: () => handleCreateFolder(folderId) },
          { id: 'sep1', label: '', separator: true },
        );
      }

      items.push(
        { id: 'rename', label: '重命名', icon: '✎', disabled: isMulti, onClick: () => startRename(target.id) },
      );

      // 书：在文件夹内时显示「移出文件夹」
      if (!isFolder && !isMulti) {
        const { id: bookId } = decode(target.id);
        const book = bookList.find((b) => b.id === bookId);
        if (book?.folderId) {
          items.push({
            id: 'move-out',
            label: '移出文件夹',
            icon: '↗',
            onClick: () => {
              void navSideAPI.ebookBookshelfMove(bookId, null);
            },
          });
        }
      }

      items.push(
        { id: 'sep2', label: '', separator: true },
        {
          id: 'delete',
          label: isMulti ? `删除 ${selectedIds.size} 项` : '删除',
          icon: '🗑',
          onClick: () => isMulti ? handleDeleteSelected() : handleDelete(target.id),
        },
      );
      return items;
    },
    [selectedIds, bookList, handleCreateFolder, handleImport, startRename, handleDelete, handleDeleteSelected],
  );

  // ── 键盘 ──

  const handleKeyAction = useCallback(
    (action: 'delete' | 'rename' | 'enter', target: TreeNode) => {
      if (action === 'delete') {
        if (selectedIds.size > 1) handleDeleteSelected();
        else handleDelete(target.id);
      } else if (action === 'rename') {
        startRename(target.id);
      } else if (action === 'enter') {
        if (target.kind === 'item') void handleItemClick(target);
      }
    },
    [selectedIds, handleDeleteSelected, handleDelete, startRename, handleItemClick],
  );

  // ── 工具 ──

  const fileIcon = (fileType: string): string => FILE_ICONS[fileType] ?? '📄';

  return {
    nodes: buildTreeNodes(),
    selectedIds,
    setSelectedIds,
    handleFolderToggle,
    handleItemClick,
    buildContextMenu,
    handleDrop,
    handleKeyAction,
    renamingId,
    renameValue,
    setRenameValue,
    startRename,
    commitRename,
    cancelRename,
    handleCreateFolder,
    handleImport,
    importModal,
    importStorage,
    setImportStorage,
    handleImportConfirm,
    cancelImport,
    toast,
    dismissToast: () => setToast(null),
    activeBookId,
    fileIcon,
    bookList,
    folderList,
  };
}
