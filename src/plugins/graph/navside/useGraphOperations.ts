/**
 * useGraphOperations — Graph 业务操作 hook(对齐 useEBookOperations / useNoteOperations)
 *
 * 镜像形态:
 * - graphList + folderList → TreeNode[] 给 FolderTree
 * - 维护选中 / 重命名 / 拖拽业务回调
 * - 提供 contextMenu / onDrop / onKey
 *
 * v1 范围(与 spec Canvas.md §3.2 对齐):
 * - 双 actionBar 按钮:create-canvas / create-folder
 * - 单击 → 切到 graph workMode + open-in-view
 * - 重命名 / 删除 / 移动文件夹 / 拖拽全套
 * - 不实现:画板预览图(M2+ 的"卡片视图"留 v1.5+)
 */
import { useState, useCallback } from 'react';
import { useActiveState } from '../../../renderer/navside/store/useActiveState';
import { activeStateStore } from '../../../renderer/navside/store/active-state-store';
import { useGraphSync } from './useGraphSync';
import type { GraphCanvasListItem, GraphFolderRecord } from '../../../shared/types/graph-types';
import type {
  TreeNode, FolderNode, ItemNode, ContextMenuItem,
} from '../../../renderer/navside/components/FolderTree';

declare const navSideAPI: {
  switchWorkMode: (id: string) => Promise<void>;
  graphCreate: (title?: string, variant?: string, folderId?: string | null) => Promise<{ id: string; title: string } | null>;
  graphRename: (id: string, title: string) => Promise<void>;
  graphDelete: (id: string) => Promise<void>;
  graphMoveToFolder: (id: string, folderId: string | null) => Promise<void>;
  graphDuplicate: (id: string, targetFolderId?: string | null) => Promise<unknown>;
  graphOpenInView: (id: string) => Promise<void>;
  graphFolderCreate: (title: string, parentId?: string | null) => Promise<GraphFolderRecord | null>;
  graphFolderRename: (id: string, title: string) => Promise<void>;
  graphFolderDelete: (id: string) => Promise<void>;
  graphFolderMove: (id: string, parentId: string | null) => Promise<void>;
  closeRightSlot: () => Promise<void>;
};

export function useGraphOperations() {
  const { graphList, folderList } = useGraphSync();
  const activeGraphId = useActiveState((s) => s.activeGraphId);
  const expandedFolders = useActiveState((s) => s.graphExpandedFolders);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const expandedSet = new Set(expandedFolders);

  // ── tree id 编码:g:graphId / f:folderId ──
  const decode = (treeId: string): { type: 'graph' | 'folder'; id: string } => ({
    type: treeId.startsWith('f:') ? 'folder' : 'graph',
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

      const graphs = graphList
        .filter((g) => g.folder_id === parentId)
        .sort((a, b) => b.updated_at - a.updated_at);
      for (const g of graphs) {
        const itemNode: ItemNode = {
          kind: 'item',
          id: `g:${g.id}`,
          parentId: parentId ? `f:${parentId}` : null,
          payload: g,
        };
        nodes.push(itemNode);
      }

      return nodes;
    };
    return buildChildren(null);
  }, [graphList, folderList, expandedSet]);

  // ── 折叠 ──
  const handleFolderToggle = useCallback((treeId: string, expand: boolean) => {
    if (!treeId.startsWith('f:')) return;
    const folderId = treeId.slice(2);
    const next = new Set(expandedFolders);
    if (expand) next.add(folderId);
    else next.delete(folderId);
    activeStateStore.setGraphExpandedFoldersLocal(Array.from(next));
  }, [expandedFolders]);

  // ── 单击 = 打开画板 ──
  const handleItemClick = useCallback(async (item: ItemNode) => {
    const { type, id } = decode(item.id);
    if (type !== 'graph') return;
    void navSideAPI.closeRightSlot();
    // 切到 graph workMode(若不在),然后 open-in-view
    await navSideAPI.switchWorkMode('graph');
    void navSideAPI.graphOpenInView(id);
    activeStateStore.setActiveGraphIdLocal(id);
  }, []);

  // ── 创建画板 ──
  const handleCreateCanvas = useCallback((parentId?: string | null) => {
    void navSideAPI.graphCreate('未命名画板', 'canvas', parentId ?? null).then((g) => {
      if (g?.id) {
        // 自动展开父文件夹 + 进入重命名
        if (parentId) {
          const next = new Set(expandedFolders);
          next.add(parentId);
          activeStateStore.setGraphExpandedFoldersLocal(Array.from(next));
        }
        setRenamingId(`g:${g.id}`);
        setRenameValue(g.title || '未命名画板');
      }
    });
  }, [expandedFolders]);

  // ── 创建文件夹 ──
  const handleCreateFolder = useCallback((parentId?: string | null) => {
    void navSideAPI.graphFolderCreate('新建文件夹', parentId ?? null).then((f) => {
      if (f?.id) {
        if (parentId) {
          const next = new Set(expandedFolders);
          next.add(parentId);
          activeStateStore.setGraphExpandedFoldersLocal(Array.from(next));
        }
        setRenamingId(`f:${f.id}`);
        setRenameValue(f.title || '新建文件夹');
      }
    });
  }, [expandedFolders]);

  // ── 重命名 ──
  const startRename = useCallback((treeId: string) => {
    const { type, id } = decode(treeId);
    if (type === 'graph') {
      const g = graphList.find((x) => x.id === id);
      if (!g) return;
      setRenamingId(treeId);
      setRenameValue(g.title || '');
    } else {
      const f = folderList.find((x) => x.id === id);
      if (!f) return;
      setRenamingId(treeId);
      setRenameValue(f.title || '');
    }
  }, [graphList, folderList]);

  const commitRename = useCallback((treeId: string) => {
    if (!renamingId || renamingId !== treeId) return;
    const { type, id } = decode(treeId);
    const trimmed = renameValue.trim();
    if (trimmed) {
      if (type === 'graph') void navSideAPI.graphRename(id, trimmed);
      else void navSideAPI.graphFolderRename(id, trimmed);
    }
    setRenamingId(null);
  }, [renamingId, renameValue]);

  const cancelRename = useCallback(() => setRenamingId(null), []);

  // ── 删除 ──
  const handleDelete = useCallback((treeId: string) => {
    const { type, id } = decode(treeId);
    if (type === 'graph') {
      void navSideAPI.graphDelete(id);
      if (activeGraphId === id) activeStateStore.setActiveGraphIdLocal(null);
    } else {
      void navSideAPI.graphFolderDelete(id);
    }
  }, [activeGraphId]);

  const handleDeleteSelected = useCallback(() => {
    for (const treeId of selectedIds) {
      const { type, id } = decode(treeId);
      if (type === 'graph') {
        void navSideAPI.graphDelete(id);
        if (activeGraphId === id) activeStateStore.setActiveGraphIdLocal(null);
      } else {
        void navSideAPI.graphFolderDelete(id);
      }
    }
    setSelectedIds(new Set());
  }, [selectedIds, activeGraphId]);

  // ── 拖拽 ──
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
      if (type === 'graph') {
        const g = graphList.find((x) => x.id === id);
        if (g && (g.folder_id ?? null) !== targetFolderId) {
          void navSideAPI.graphMoveToFolder(id, targetFolderId);
          if (targetFolderId) needExpand = true;
        }
      } else {
        const f = folderList.find((x) => x.id === id);
        if (f && f.parent_id !== targetFolderId) {
          if (!targetFolderId || !isDescendantFolder(id, targetFolderId)) {
            void navSideAPI.graphFolderMove(id, targetFolderId);
            if (targetFolderId) needExpand = true;
          }
        }
      }
    }
    if (needExpand && targetFolderId) {
      const next = new Set(expandedFolders);
      next.add(targetFolderId);
      activeStateStore.setGraphExpandedFoldersLocal(Array.from(next));
    }
  }, [graphList, folderList, expandedFolders, isDescendantFolder]);

  // ── 右键菜单 ──
  const buildContextMenu = useCallback(
    (target: TreeNode | null): ContextMenuItem[] => {
      if (!target) {
        return [
          { id: 'new-canvas', label: '新建画板', icon: '🎨', onClick: () => handleCreateCanvas(null) },
          { id: 'new-folder', label: '新建文件夹', icon: '📁', onClick: () => handleCreateFolder(null) },
        ];
      }
      const isMulti = selectedIds.size > 1 && selectedIds.has(target.id);
      const isFolder = target.kind === 'folder';
      const items: ContextMenuItem[] = [];

      if (isFolder) {
        const folderId = target.id.slice(2);
        items.push(
          { id: 'new-canvas-in', label: '在此新建画板', icon: '🎨', onClick: () => handleCreateCanvas(folderId) },
          { id: 'new-folder-in', label: '在此新建文件夹', icon: '📁', onClick: () => handleCreateFolder(folderId) },
          { id: 'sep1', label: '', separator: true },
        );
      }

      items.push(
        { id: 'rename', label: '重命名', icon: '✎', disabled: isMulti, onClick: () => startRename(target.id) },
      );

      // 画板:在文件夹内时显示「移出文件夹」
      if (!isFolder && !isMulti) {
        const { id: graphId } = decode(target.id);
        const g = graphList.find((x) => x.id === graphId);
        if (g?.folder_id) {
          items.push({
            id: 'move-out',
            label: '移出文件夹',
            icon: '↗',
            onClick: () => void navSideAPI.graphMoveToFolder(graphId, null),
          });
        }
        items.push({
          id: 'duplicate',
          label: '复制',
          icon: '📋',
          onClick: () => void navSideAPI.graphDuplicate(graphId, null),
        });
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
    [selectedIds, graphList, handleCreateCanvas, handleCreateFolder, startRename, handleDelete, handleDeleteSelected],
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
    handleCreateCanvas,
    handleCreateFolder,
    activeGraphId,
    graphList,
    folderList,
  };
}
