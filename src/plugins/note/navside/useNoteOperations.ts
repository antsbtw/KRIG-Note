/**
 * useNoteOperations — Note 业务操作 hook（v1.4 NavSide 重构）。
 *
 * 职责：
 * - 维护选中 / 重命名 / 排序 / 剪贴板等 UI 状态
 * - 暴露 CRUD 调用（noteCreate / folderCreate / noteRename / noteDelete / ...）
 * - 把 noteList + folderList + sortMap + expandedFolders 转成 FolderTree 的 nodes
 * - 提供 contextMenu / onDrop / onKey 等 FolderTree 回调
 *
 * 数据来源：
 * - 数据列表：useNoteSync()
 * - 当前活跃 / 展开状态：useActiveState(s => s.xxx)（来自 ActiveStateStore）
 * - 操作的副作用：调 navSideAPI 直接 IPC，主进程 onNoteListChanged 回流刷新
 */
import { useState, useCallback, useRef } from 'react';
import { useActiveState } from '../../../renderer/navside/store/useActiveState';
import { activeStateStore } from '../../../renderer/navside/store/active-state-store';
import {
  useNoteSync,
  type NoteListItem,
  type FolderRecord,
} from './useNoteSync';
import type { TreeNode, FolderNode, ItemNode, ContextMenuItem } from '../../../renderer/navside/components/FolderTree';

declare const navSideAPI: {
  switchWorkMode: (id: string) => Promise<void>;
  executeAction: (actionId: string, params?: Record<string, unknown>) => Promise<unknown>;
  noteCreate: (title?: string, folderId?: string | null) => Promise<{ id: string; title?: string }>;
  noteDelete: (id: string) => Promise<void>;
  noteRename: (id: string, title: string) => Promise<void>;
  noteMoveToFolder: (noteId: string, folderId: string | null) => Promise<void>;
  noteOpenInEditor: (id: string) => Promise<void>;
  folderCreate: (title: string, parentId?: string | null) => Promise<{ id: string; title?: string }>;
  folderRename: (id: string, title: string) => Promise<void>;
  folderDelete: (id: string) => Promise<void>;
  folderMove: (id: string, parentId: string | null) => Promise<void>;
  closeRightSlot: () => Promise<void>;
};

type SortState = 'title-asc' | 'title-desc' | 'date-asc' | 'date-desc';

export function useNoteOperations() {
  const { noteList, folderList } = useNoteSync();
  const activeNoteId = useActiveState((s) => s.activeNoteId);
  const expandedFolders = useActiveState((s) => s.expandedFolders);

  // 选中态由 FolderTree 受控管理；上层只持有 selectedIds
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // 重命名状态
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // 排序：每个 folder 独立排序状态（含 __root__）
  const [folderSortMap, setFolderSortMap] = useState<Record<string, SortState>>({});

  // 剪贴板
  const [clipboard, setClipboard] = useState<{ type: 'note' | 'folder'; id: string } | null>(null);

  // ── 排序工具 ──

  const getSortedFolders = useCallback(
    (parentId: string | null): FolderRecord[] => {
      const folders = folderList.filter((f) => f.parent_id === parentId);
      const key = parentId ?? '__root__';
      const sort = folderSortMap[key];
      const sorted = [...folders];
      if (sort === 'title-asc') sorted.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
      else if (sort === 'title-desc') sorted.sort((a, b) => b.title.localeCompare(a.title, 'zh-CN'));
      else if (sort === 'date-asc') sorted.sort((a, b) => a.created_at - b.created_at);
      else if (sort === 'date-desc') sorted.sort((a, b) => b.created_at - a.created_at);
      else sorted.sort((a, b) => a.sort_order - b.sort_order);
      return sorted;
    },
    [folderList, folderSortMap],
  );

  const getSortedNotes = useCallback(
    (folderId: string | null): NoteListItem[] => {
      const notes = noteList.filter((n) => n.folder_id === folderId);
      const key = folderId ?? '__root__';
      const sort = folderSortMap[key];
      const sorted = [...notes];
      if (sort === 'title-asc') sorted.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
      else if (sort === 'title-desc') sorted.sort((a, b) => b.title.localeCompare(a.title, 'zh-CN'));
      else if (sort === 'date-asc') sorted.sort((a, b) => a.updated_at - b.updated_at);
      else if (sort === 'date-desc') sorted.sort((a, b) => b.updated_at - a.updated_at);
      else sorted.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
      return sorted;
    },
    [noteList, folderSortMap],
  );

  // ── 构建 TreeNode[] 给 FolderTree ──

  const buildTreeNodes = useCallback((): TreeNode[] => {
    const buildChildren = (parentId: string | null): TreeNode[] => {
      const nodes: TreeNode[] = [];
      // 文件夹优先
      for (const f of getSortedFolders(parentId)) {
        const folderNode: FolderNode = {
          kind: 'folder',
          id: `f:${f.id}`,
          parentId: parentId ? `f:${parentId}` : null,
          title: f.title,
          expanded: expandedFolders.has(f.id),
          children: buildChildren(f.id),
        };
        nodes.push(folderNode);
      }
      // 笔记
      for (const n of getSortedNotes(parentId)) {
        const itemNode: ItemNode = {
          kind: 'item',
          id: `n:${n.id}`,
          parentId: parentId ? `f:${parentId}` : null,
          payload: n,
        };
        nodes.push(itemNode);
      }
      return nodes;
    };
    return buildChildren(null);
  }, [getSortedFolders, getSortedNotes, expandedFolders]);

  // ── id 转换 ──

  const decode = (treeId: string): { type: 'note' | 'folder'; id: string } => {
    return { type: treeId.startsWith('f:') ? 'folder' : 'note', id: treeId.slice(2) };
  };

  // ── 折叠/展开 ──

  const handleFolderToggle = useCallback((treeId: string, expand: boolean) => {
    if (!treeId.startsWith('f:')) return;
    const folderId = treeId.slice(2);
    const next = new Set(expandedFolders);
    if (expand) next.add(folderId);
    else next.delete(folderId);
    activeStateStore.updateNoteExpandedFolders(next);
  }, [expandedFolders]);

  // ── 单击 ──

  const handleItemClick = useCallback((item: ItemNode) => {
    const { type, id } = decode(item.id);
    if (type === 'note') {
      activeStateStore.setActiveNoteIdLocal(id);
      void navSideAPI.closeRightSlot();
      void navSideAPI.noteOpenInEditor(id);
    }
  }, []);

  // ── 创建 ──

  const handleCreateNote = useCallback((folderId?: string | null) => {
    void navSideAPI.noteCreate('新建笔记', folderId).then((note) => {
      if (note?.id) {
        activeStateStore.setActiveNoteIdLocal(note.id);
        void navSideAPI.noteOpenInEditor(note.id);
        setRenamingId(`n:${note.id}`);
        setRenameValue(note.title || '新建笔记');
      }
    });
  }, []);

  const handleCreateFolder = useCallback((parentId?: string | null) => {
    void navSideAPI.folderCreate('新建文件夹', parentId).then((folder) => {
      if (folder?.id) {
        if (parentId) {
          const next = new Set(expandedFolders);
          next.add(parentId);
          activeStateStore.updateNoteExpandedFolders(next);
        }
        setRenamingId(`f:${folder.id}`);
        setRenameValue(folder.title || '新建文件夹');
      }
    });
  }, [expandedFolders]);

  // ── ActionBar 处理 ──

  const handleSwitchMode = useCallback((id: string) => {
    void navSideAPI.closeRightSlot();
    void navSideAPI.switchWorkMode(id);
  }, []);

  const handleActionBarClick = useCallback((actionId: string) => {
    switch (actionId) {
      case 'create-folder':
        handleCreateFolder();
        break;
      case 'create-note':
        handleCreateNote();
        break;
      default:
        navSideAPI.executeAction(actionId).catch((err: unknown) => {
          console.warn('[NavSide] executeAction failed:', actionId, err);
        });
    }
  }, [handleCreateFolder, handleCreateNote]);

  // ── 重命名 ──

  const startRename = useCallback((treeId: string) => {
    const { type, id } = decode(treeId);
    const item = type === 'note'
      ? noteList.find((n) => n.id === id)
      : folderList.find((f) => f.id === id);
    if (!item) return;
    setRenamingId(treeId);
    setRenameValue(item.title);
  }, [noteList, folderList]);

  const commitRename = useCallback((treeId: string) => {
    if (!renamingId || renamingId !== treeId) return;
    const { type, id } = decode(treeId);
    const trimmed = renameValue.trim();
    if (trimmed) {
      if (type === 'note') void navSideAPI.noteRename(id, trimmed);
      else void navSideAPI.folderRename(id, trimmed);
    }
    setRenamingId(null);
  }, [renamingId, renameValue]);

  const cancelRename = useCallback(() => setRenamingId(null), []);

  // ── 删除 ──

  const handleDelete = useCallback((treeId: string) => {
    const { type, id } = decode(treeId);
    if (type === 'note') {
      void navSideAPI.noteDelete(id);
      if (activeNoteId === id) activeStateStore.setActiveNoteIdLocal(null);
    } else {
      void navSideAPI.folderDelete(id);
    }
  }, [activeNoteId]);

  const handleDeleteSelected = useCallback(() => {
    for (const treeId of selectedIds) {
      const { type, id } = decode(treeId);
      if (type === 'note') {
        void navSideAPI.noteDelete(id);
        if (activeNoteId === id) activeStateStore.setActiveNoteIdLocal(null);
      } else {
        void navSideAPI.folderDelete(id);
      }
    }
    setSelectedIds(new Set());
  }, [selectedIds, activeNoteId]);

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
      if (type === 'note') {
        const note = noteList.find((n) => n.id === id);
        if (note && note.folder_id !== targetFolderId) {
          void navSideAPI.noteMoveToFolder(id, targetFolderId);
          if (targetFolderId) needExpand = true;
        }
      } else {
        const folder = folderList.find((f) => f.id === id);
        if (folder && folder.parent_id !== targetFolderId) {
          if (!targetFolderId || !isDescendantFolder(id, targetFolderId)) {
            void navSideAPI.folderMove(id, targetFolderId);
            if (targetFolderId) needExpand = true;
          }
        }
      }
    }
    if (needExpand && targetFolderId) {
      const next = new Set(expandedFolders);
      next.add(targetFolderId);
      activeStateStore.updateNoteExpandedFolders(next);
    }
  }, [noteList, folderList, expandedFolders, isDescendantFolder]);

  // ── 右键菜单 ──

  const buildContextMenu = useCallback(
    (target: TreeNode | null): ContextMenuItem[] => {
      if (!target) {
        // 空白处右键：创建 + 排序
        return [
          { id: 'new-note', label: '新建笔记', icon: '📄', onClick: () => handleCreateNote() },
          { id: 'new-folder', label: '新建文件夹', icon: '📁', onClick: () => handleCreateFolder() },
          { id: 'sep1', label: '', separator: true },
          {
            id: 'sort-title',
            label: `按标题排序${folderSortMap['__root__']?.startsWith('title') ? (folderSortMap['__root__'] === 'title-asc' ? ' ↑' : ' ↓') : ''}`,
            onClick: () => {
              setFolderSortMap((m) => ({
                ...m,
                __root__: m['__root__'] === 'title-asc' ? 'title-desc' : 'title-asc',
              }));
            },
          },
          {
            id: 'sort-date',
            label: `按日期排序${folderSortMap['__root__']?.startsWith('date') ? (folderSortMap['__root__'] === 'date-asc' ? ' ↑' : ' ↓') : ''}`,
            onClick: () => {
              setFolderSortMap((m) => ({
                ...m,
                __root__: m['__root__'] === 'date-asc' ? 'date-desc' : 'date-asc',
              }));
            },
          },
        ];
      }
      // item / folder 上的右键
      const isMulti = selectedIds.size > 1 && selectedIds.has(target.id);
      const isFolder = target.kind === 'folder';
      const items: ContextMenuItem[] = [];

      if (isFolder) {
        const folderId = target.id.slice(2);
        items.push(
          { id: 'new-note-in', label: '在此新建笔记', icon: '📄', onClick: () => handleCreateNote(folderId) },
          { id: 'new-folder-in', label: '在此新建文件夹', icon: '📁', onClick: () => handleCreateFolder(folderId) },
          { id: 'sep1', label: '', separator: true },
        );
      }

      items.push(
        { id: 'rename', label: '重命名', icon: '✎', disabled: isMulti, onClick: () => startRename(target.id) },
        { id: 'copy', label: '复制', icon: '📋', disabled: isMulti, onClick: () => {
          const { type, id } = decode(target.id);
          setClipboard({ type, id });
        }},
        ...(clipboard && isFolder ? [{ id: 'paste', label: '粘贴', icon: '📌', onClick: () => {
          if (!clipboard) return;
          void navSideAPI.executeAction('paste', {
            clipboardType: clipboard.type,
            clipboardId: clipboard.id,
            targetFolderId: target.id.slice(2),
          });
        }}] : []),
        { id: 'sep2', label: '', separator: true },
        { id: 'delete', label: isMulti ? `删除 ${selectedIds.size} 项` : '删除', icon: '🗑',
          onClick: () => isMulti ? handleDeleteSelected() : handleDelete(target.id) },
      );
      return items;
    },
    [selectedIds, folderSortMap, clipboard, handleCreateNote, handleCreateFolder, startRename, handleDelete, handleDeleteSelected],
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
        if (target.kind === 'item') {
          handleItemClick(target);
        }
      }
    },
    [selectedIds, handleDeleteSelected, handleDelete, startRename, handleItemClick],
  );

  // void: silence unused warnings if any
  void useRef;

  return {
    // FolderTree props
    nodes: buildTreeNodes(),
    selectedIds,
    setSelectedIds,
    handleFolderToggle,
    handleItemClick,
    buildContextMenu,
    handleDrop,
    handleKeyAction,
    // 重命名
    renamingId,
    renameValue,
    setRenameValue,
    commitRename,
    cancelRename,
    // 框架转发
    handleSwitchMode,
    handleActionBarClick,
    // 状态查询（NavSide.tsx 可能用）
    activeNoteId,
    folderSortMap,
  };
}
