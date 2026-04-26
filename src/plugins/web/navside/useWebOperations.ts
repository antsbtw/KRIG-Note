/**
 * useWebOperations — Web 书签业务操作 hook（v1.4 NavSide 重构 M5）。
 *
 * 镜像 useNoteOperations / useGraphOperations：
 * - bookmarkList + folderList → TreeNode[] 给 FolderTree
 * - 维护选中 / 重命名 / 拖拽业务回调
 * - 提供 contextMenu / onDrop / onKey
 *
 * 注：Web 没有"创建书签"——书签由 WebView 内的"加书签"流程触发。
 *     NavSide 只负责「文件夹 CRUD + 已有书签的整理」。
 */
import { useState, useCallback } from 'react';
import { useActiveState } from '../../../renderer/navside/store/useActiveState';
import { activeStateStore } from '../../../renderer/navside/store/active-state-store';
import {
  useWebSync,
  type WebBookmark,
  type WebFolder,
} from './useWebSync';
import type { TreeNode, FolderNode, ItemNode, ContextMenuItem } from '../../../renderer/navside/components/FolderTree';

declare const navSideAPI: {
  webBookmarkRemove: (id: string) => Promise<void>;
  webBookmarkUpdate: (id: string, fields: { title?: string; url?: string; favicon?: string }) => Promise<void>;
  webBookmarkMove: (id: string, folderId: string | null) => Promise<void>;
  webFolderCreate: (title: string, parentId?: string | null) => Promise<WebFolder | null>;
  webFolderRename: (id: string, title: string) => Promise<void>;
  webFolderDelete: (id: string) => Promise<void>;
  webFolderMove: (id: string, parentId: string | null) => Promise<void>;
  closeRightSlot: () => Promise<void>;
};

export function useWebOperations() {
  const { bookmarkList, folderList } = useWebSync();
  const expandedFolders = useActiveState((s) => s.webExpandedFolders);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const expandedSet = new Set(expandedFolders);

  // tree id 编码：b:bookmarkId / f:folderId
  const decode = (treeId: string): { type: 'bookmark' | 'folder'; id: string } => ({
    type: treeId.startsWith('f:') ? 'folder' : 'bookmark',
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

      const bookmarks = bookmarkList
        .filter((b) => (b.folderId ?? null) === parentId)
        .sort((a, b) => b.createdAt - a.createdAt);
      for (const b of bookmarks) {
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
  }, [bookmarkList, folderList, expandedSet]);

  // ── 折叠 ──

  const handleFolderToggle = useCallback((treeId: string, expand: boolean) => {
    if (!treeId.startsWith('f:')) return;
    const folderId = treeId.slice(2);
    const next = new Set(expandedFolders);
    if (expand) next.add(folderId);
    else next.delete(folderId);
    activeStateStore.setWebExpandedFoldersLocal(Array.from(next));
  }, [expandedFolders]);

  // ── 单击 = 在当前 WebView 中导航到 URL ──

  const handleItemClick = useCallback((item: ItemNode) => {
    const { type, id } = decode(item.id);
    if (type !== 'bookmark') return;
    const bk = bookmarkList.find((b) => b.id === id);
    if (!bk) return;
    void navSideAPI.closeRightSlot();
    // WebView 监听这个 message 处理导航
    window.postMessage({ type: 'web:navigate', url: bk.url }, '*');
  }, [bookmarkList]);

  // ── 创建文件夹 ──

  const handleCreateFolder = useCallback((parentId?: string | null) => {
    void navSideAPI.webFolderCreate('新建文件夹', parentId).then((f) => {
      if (f?.id) {
        if (parentId) {
          const next = new Set(expandedFolders);
          next.add(parentId);
          activeStateStore.setWebExpandedFoldersLocal(Array.from(next));
        }
        setRenamingId(`f:${f.id}`);
        setRenameValue(f.title || '新建文件夹');
      }
    });
  }, [expandedFolders]);

  // ── 重命名 ──

  const startRename = useCallback((treeId: string) => {
    const { type, id } = decode(treeId);
    if (type === 'bookmark') {
      const bk = bookmarkList.find((b) => b.id === id);
      if (!bk) return;
      setRenamingId(treeId);
      setRenameValue(bk.title || '');
    } else {
      const folder = folderList.find((f) => f.id === id);
      if (!folder) return;
      setRenamingId(treeId);
      setRenameValue(folder.title || '');
    }
  }, [bookmarkList, folderList]);

  const commitRename = useCallback((treeId: string) => {
    if (!renamingId || renamingId !== treeId) return;
    const { type, id } = decode(treeId);
    const trimmed = renameValue.trim();
    if (trimmed) {
      if (type === 'bookmark') void navSideAPI.webBookmarkUpdate(id, { title: trimmed });
      else void navSideAPI.webFolderRename(id, trimmed);
    }
    setRenamingId(null);
  }, [renamingId, renameValue]);

  const cancelRename = useCallback(() => setRenamingId(null), []);

  // ── 删除 ──

  const handleDelete = useCallback((treeId: string) => {
    const { type, id } = decode(treeId);
    if (type === 'bookmark') void navSideAPI.webBookmarkRemove(id);
    else void navSideAPI.webFolderDelete(id);
  }, []);

  const handleDeleteSelected = useCallback(() => {
    for (const treeId of selectedIds) {
      const { type, id } = decode(treeId);
      if (type === 'bookmark') void navSideAPI.webBookmarkRemove(id);
      else void navSideAPI.webFolderDelete(id);
    }
    setSelectedIds(new Set());
  }, [selectedIds]);

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
      if (type === 'bookmark') {
        const bk = bookmarkList.find((x) => x.id === id);
        if (bk && (bk.folderId ?? null) !== targetFolderId) {
          void navSideAPI.webBookmarkMove(id, targetFolderId);
          if (targetFolderId) needExpand = true;
        }
      } else {
        const f = folderList.find((x) => x.id === id);
        if (f && f.parent_id !== targetFolderId) {
          if (!targetFolderId || !isDescendantFolder(id, targetFolderId)) {
            void navSideAPI.webFolderMove(id, targetFolderId);
            if (targetFolderId) needExpand = true;
          }
        }
      }
    }
    if (needExpand && targetFolderId) {
      const next = new Set(expandedFolders);
      next.add(targetFolderId);
      activeStateStore.setWebExpandedFoldersLocal(Array.from(next));
    }
  }, [bookmarkList, folderList, expandedFolders, isDescendantFolder]);

  // ── 右键菜单 ──

  const buildContextMenu = useCallback(
    (target: TreeNode | null): ContextMenuItem[] => {
      if (!target) {
        return [
          { id: 'new-folder', label: '新建文件夹', icon: '📁', onClick: () => handleCreateFolder(null) },
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

      if (!isFolder && !isMulti) {
        const { id: bkId } = decode(target.id);
        const bk = bookmarkList.find((b) => b.id === bkId);
        if (bk?.folderId) {
          items.push({
            id: 'move-out',
            label: '移出文件夹',
            icon: '↗',
            onClick: () => void navSideAPI.webBookmarkMove(bkId, null),
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
    [selectedIds, bookmarkList, handleCreateFolder, startRename, handleDelete, handleDeleteSelected],
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
        if (target.kind === 'item') handleItemClick(target);
      }
    },
    [selectedIds, handleDeleteSelected, handleDelete, startRename, handleItemClick],
  );

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
    bookmarkList,
    folderList,
  };
}
