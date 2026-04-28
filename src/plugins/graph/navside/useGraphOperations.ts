/**
 * useGraphOperations — Graph 业务操作 hook（v1.4 NavSide 重构 M3）。
 *
 * 镜像 useNoteOperations：
 * - 维护选中 / 重命名 / 排序 / 剪贴板等 UI 状态
 * - 暴露 CRUD 调用 + variant 创建
 * - 把 graphList + folderList → TreeNode[] 给 FolderTree
 * - 提供 contextMenu / onDrop / onKey 等 FolderTree 回调
 */
import { useState, useCallback } from 'react';
import { useActiveState } from '../../../renderer/navside/store/useActiveState';
import { activeStateStore } from '../../../renderer/navside/store/active-state-store';
import {
  useGraphSync,
  type GraphListItem,
  type GraphFolderRecord,
} from './useGraphSync';
import type { TreeNode, FolderNode, ItemNode, ContextMenuItem } from '../../../renderer/navside/components/FolderTree';

declare const navSideAPI: {
  switchWorkMode: (id: string) => Promise<void>;
  executeAction: (actionId: string, params?: Record<string, unknown>) => Promise<unknown>;
  graphCreate: (title?: string, hostNoteId?: string | null, variant?: string, folderId?: string | null) => Promise<{ id: string; title?: string } | null>;
  graphRename: (id: string, title: string) => Promise<void>;
  graphDelete: (id: string) => Promise<void>;
  graphSetActive: (id: string | null) => Promise<void>;
  graphMoveToFolder: (id: string, folderId: string | null) => Promise<void>;
  graphFolderCreate: (title: string, parentId?: string | null) => Promise<{ id: string; title?: string } | null>;
  graphFolderRename: (id: string, title: string) => Promise<void>;
  graphFolderDelete: (id: string) => Promise<void>;
  graphFolderMove: (id: string, parentId: string | null) => Promise<void>;
  closeRightSlot: () => Promise<void>;
};

type SortState = 'title-asc' | 'title-desc' | 'date-asc' | 'date-desc';

/** v1.4 启用的变种集合（MindMap / BPMN / Timeline / Canvas v1.5+ 启用） */
export const AVAILABLE_VARIANTS = [
  { id: 'knowledge', label: '知识图谱', icon: '⚛' },
  { id: 'basic', label: '基础图', icon: '○' },
] as const;

export type VariantId = typeof AVAILABLE_VARIANTS[number]['id'];

const VARIANT_ICONS: Record<string, string> = {
  knowledge: '⚛',
  mindmap: '☘',
  bpmn: '⊳',
  timeline: '⏱',
  canvas: '◫',
  basic: '○',
};

export function useGraphOperations() {
  const { graphList, folderList } = useGraphSync();
  const activeGraphId = useActiveState((s) => s.activeGraphId);
  const expandedFolders = useActiveState((s) => s.graphExpandedFolders);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [folderSortMap, setFolderSortMap] = useState<Record<string, SortState>>({});
  const [clipboard, setClipboard] = useState<{ type: 'graph' | 'folder'; id: string } | null>(null);

  // expandedFolders 是 Set 还是 string[]（store 里 graphExpandedFolders 是 string[]）
  const expandedSet = new Set(expandedFolders);

  // ── 排序 ──

  const getSortedFolders = useCallback(
    (parentId: string | null): GraphFolderRecord[] => {
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

  const getSortedGraphs = useCallback(
    (folderId: string | null): GraphListItem[] => {
      const graphs = graphList.filter((g) => (g.folder_id ?? null) === folderId);
      const key = folderId ?? '__root__';
      const sort = folderSortMap[key];
      const sorted = [...graphs];
      if (sort === 'title-asc') sorted.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
      else if (sort === 'title-desc') sorted.sort((a, b) => b.title.localeCompare(a.title, 'zh-CN'));
      else if (sort === 'date-asc') sorted.sort((a, b) => a.updated_at - b.updated_at);
      else if (sort === 'date-desc') sorted.sort((a, b) => b.updated_at - a.updated_at);
      else sorted.sort((a, b) => b.updated_at - a.updated_at); // 默认按更新时间倒序
      return sorted;
    },
    [graphList, folderSortMap],
  );

  // ── TreeNode[] ──

  const buildTreeNodes = useCallback((): TreeNode[] => {
    const buildChildren = (parentId: string | null): TreeNode[] => {
      const nodes: TreeNode[] = [];
      for (const f of getSortedFolders(parentId)) {
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
      for (const g of getSortedGraphs(parentId)) {
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
  }, [getSortedFolders, getSortedGraphs, expandedSet]);

  const decode = (treeId: string): { type: 'graph' | 'folder'; id: string } => ({
    type: treeId.startsWith('f:') ? 'folder' : 'graph',
    id: treeId.slice(2),
  });

  // ── 折叠 ──

  const handleFolderToggle = useCallback((treeId: string, expand: boolean) => {
    if (!treeId.startsWith('f:')) return;
    const folderId = treeId.slice(2);
    const next = new Set(expandedFolders);
    if (expand) next.add(folderId);
    else next.delete(folderId);
    activeStateStore.setGraphExpandedFoldersLocal(Array.from(next));
  }, [expandedFolders]);

  // ── 单击 = 打开图 ──

  const handleItemClick = useCallback((item: ItemNode) => {
    const { type, id } = decode(item.id);
    if (type !== 'graph') return;
    void navSideAPI.closeRightSlot();
    void navSideAPI.graphSetActive(id);
    activeStateStore.setActiveGraphIdLocal(id);
  }, []);

  // ── 创建 ──

  const handleCreateGraph = useCallback(
    (variant: VariantId = 'knowledge', folderId?: string | null) => {
      void navSideAPI
        .graphCreate('未命名图谱', null, variant, folderId ?? null)
        .then((g) => {
          if (g?.id) {
            setRenamingId(`g:${g.id}`);
            setRenameValue(g.title || '未命名图谱');
            // 自动展开父 folder
            if (folderId) {
              const next = new Set(expandedFolders);
              next.add(folderId);
              activeStateStore.setGraphExpandedFoldersLocal(Array.from(next));
            }
          }
        });
    },
    [expandedFolders],
  );

  const handleCreateFolder = useCallback((parentId?: string | null) => {
    void navSideAPI.graphFolderCreate('新建文件夹', parentId).then((f) => {
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

  // ── ActionBar ──

  const handleSwitchMode = useCallback((id: string) => {
    void navSideAPI.closeRightSlot();
    void navSideAPI.switchWorkMode(id);
  }, []);

  // ── 重命名 ──

  const startRename = useCallback((treeId: string) => {
    const { type, id } = decode(treeId);
    const item = type === 'graph'
      ? graphList.find((g) => g.id === id)
      : folderList.find((f) => f.id === id);
    if (!item) return;
    setRenamingId(treeId);
    setRenameValue(item.title);
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
        // 空白处右键：创建 + 排序
        return [
          ...AVAILABLE_VARIANTS.map((v) => ({
            id: `new-${v.id}`,
            label: `新建${v.label}`,
            icon: v.icon,
            onClick: () => handleCreateGraph(v.id, null),
          })),
          { id: 'new-folder', label: '新建文件夹', icon: '📁', onClick: () => handleCreateFolder(null) },
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
      const isMulti = selectedIds.size > 1 && selectedIds.has(target.id);
      const isFolder = target.kind === 'folder';
      const items: ContextMenuItem[] = [];

      if (isFolder) {
        const folderId = target.id.slice(2);
        items.push(
          ...AVAILABLE_VARIANTS.map((v) => ({
            id: `new-${v.id}-in`,
            label: `在此新建${v.label}`,
            icon: v.icon,
            onClick: () => handleCreateGraph(v.id, folderId),
          })),
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
    [selectedIds, folderSortMap, clipboard, handleCreateGraph, handleCreateFolder, startRename, handleDelete, handleDeleteSelected],
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
    handleSwitchMode,
    handleCreateGraph,
    handleCreateFolder,
    activeGraphId,
    folderSortMap,
    variantIcon: (variant: string) => VARIANT_ICONS[variant] ?? '○',
  };
}
