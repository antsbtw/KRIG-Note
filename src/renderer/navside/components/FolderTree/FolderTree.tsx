import { useState, useRef, useEffect, useCallback, type CSSProperties } from 'react';
import {
  type FolderTreeProps,
  type TreeNode,
  type FolderNode,
  type ItemNode,
  type ContextMenuItem,
  type KeyAction,
} from './types';
import { styles, TREE_INDENT_PX } from './styles';
import { ContextMenu } from './ContextMenu';

/**
 * FolderTree 通用树组件（v1.4 NavSide 重构 spec § 4）。
 *
 * 业务零知识：
 * - 不感知 note / graph / ebook / variant
 * - 强制统一 item 布局: [icon][title][rightHint]
 * - 强制统一 folder 视觉: [📁][title][展开箭头]
 * - 不暴露 renderItem / renderFolder（v1.4 决策：移除逃生口）
 *
 * 由插件控制：itemMeta / 选中态 / 展开态 / contextMenu / onDrop / onKeyAction
 * 由框架控制：行高、缩进、间距、hover、selected、拖拽底层、键盘焦点
 */
export function FolderTree({
  nodes,
  selectedIds,
  onSelectChange,
  onFolderToggle,
  itemMeta,
  onItemClick,
  onItemDoubleClick,
  contextMenu,
  draggable = false,
  onDrop,
  onKeyAction,
  emptyText = '暂无内容',
}: FolderTreeProps) {
  // ── hover / 拖拽状态 ──
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [dragHoverFolderId, setDragHoverFolderId] = useState<string | null | 'root'>(null);

  // ── 右键菜单 ──
  const [menuState, setMenuState] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const closeMenu = useCallback(() => setMenuState(null), []);

  // ── 焦点节点（键盘） ──
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 把树展平成可见行（按展开状态过滤）
  const visibleRows: Array<{ node: TreeNode; depth: number }> = [];
  function walk(list: TreeNode[], depth: number) {
    for (const n of list) {
      visibleRows.push({ node: n, depth });
      if (n.kind === 'folder' && n.expanded) walk(n.children, depth + 1);
    }
  }
  walk(nodes, 0);

  // ── 选中：单击（含 Cmd / Shift） ──
  const handleClick = (node: TreeNode, e: React.MouseEvent) => {
    setFocusedId(node.id);
    if (e.metaKey || e.ctrlKey) {
      // Cmd 多选：toggle
      const next = new Set(selectedIds);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      onSelectChange(next);
    } else if (e.shiftKey && focusedId) {
      // Shift 范围选
      const idxA = visibleRows.findIndex((r) => r.node.id === focusedId);
      const idxB = visibleRows.findIndex((r) => r.node.id === node.id);
      if (idxA >= 0 && idxB >= 0) {
        const [a, b] = idxA < idxB ? [idxA, idxB] : [idxB, idxA];
        const next = new Set(selectedIds);
        for (let i = a; i <= b; i++) next.add(visibleRows[i].node.id);
        onSelectChange(next);
      }
    } else {
      // 单选
      onSelectChange(new Set([node.id]));
    }

    if (node.kind === 'item') onItemClick?.(node, e);
  };

  // ── 折叠箭头点击（不触发选中） ──
  const handleCaretClick = (folder: FolderNode, e: React.MouseEvent) => {
    e.stopPropagation();
    onFolderToggle(folder.id, !folder.expanded);
  };

  // ── 双击 ──
  const handleDoubleClick = (node: TreeNode) => {
    if (node.kind === 'item') onItemDoubleClick?.(node);
    else onFolderToggle(node.id, !node.expanded);
  };

  // ── 右键菜单 ──
  const handleContextMenu = (target: TreeNode | null, e: React.MouseEvent) => {
    if (!contextMenu) return;
    e.preventDefault();
    e.stopPropagation();
    const items = contextMenu(target, e);
    if (items.length > 0) {
      setMenuState({ x: e.clientX, y: e.clientY, items });
    }
  };

  // ── 拖拽 ──
  const handleDragStart = (node: TreeNode, e: React.DragEvent) => {
    if (!draggable) return;
    // 拖动未选中的节点 → 重置选中为它一个
    const ids = selectedIds.has(node.id) ? Array.from(selectedIds) : [node.id];
    e.dataTransfer.setData('application/krig-tree-ids', JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'move';
    if (!selectedIds.has(node.id)) onSelectChange(new Set([node.id]));
  };

  const handleDragOverFolder = (folder: FolderNode | null, e: React.DragEvent) => {
    if (!draggable) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragHoverFolderId(folder?.id ?? 'root');
  };

  const handleDragLeaveFolder = (folder: FolderNode | null, e: React.DragEvent) => {
    if (!draggable) return;
    e.stopPropagation();
    if (dragHoverFolderId === (folder?.id ?? 'root')) setDragHoverFolderId(null);
  };

  const handleDropOnFolder = (folder: FolderNode | null, e: React.DragEvent) => {
    if (!draggable) return;
    e.preventDefault();
    e.stopPropagation();
    setDragHoverFolderId(null);
    try {
      const raw = e.dataTransfer.getData('application/krig-tree-ids');
      const ids = JSON.parse(raw) as string[];
      if (Array.isArray(ids) && ids.length > 0) {
        // 防止把 folder 拖进自己或自己的子树（业务可在 onDrop 进一步校验）
        const targetId = folder?.id ?? null;
        if (targetId && ids.includes(targetId)) return;
        onDrop?.(ids, targetId);
      }
    } catch {
      /* 忽略非 tree drop */
    }
  };

  // ── 键盘 ──
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!focusedId || visibleRows.length === 0) return;
    const idx = visibleRows.findIndex((r) => r.node.id === focusedId);
    if (idx < 0) return;
    const focusedNode = visibleRows[idx].node;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (idx < visibleRows.length - 1) {
        const next = visibleRows[idx + 1].node;
        setFocusedId(next.id);
        if (!e.shiftKey && !(e.metaKey || e.ctrlKey)) onSelectChange(new Set([next.id]));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (idx > 0) {
        const prev = visibleRows[idx - 1].node;
        setFocusedId(prev.id);
        if (!e.shiftKey && !(e.metaKey || e.ctrlKey)) onSelectChange(new Set([prev.id]));
      }
    } else if (e.key === 'ArrowRight' && focusedNode.kind === 'folder' && !focusedNode.expanded) {
      e.preventDefault();
      onFolderToggle(focusedNode.id, true);
    } else if (e.key === 'ArrowLeft' && focusedNode.kind === 'folder' && focusedNode.expanded) {
      e.preventDefault();
      onFolderToggle(focusedNode.id, false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const action: KeyAction = 'enter';
      onKeyAction?.(action, focusedNode);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onKeyAction?.('delete', focusedNode);
    } else if (e.key === 'F2') {
      e.preventDefault();
      onKeyAction?.('rename', focusedNode);
    }
  };

  // 焦点节点变化时，containerRef 需要拥有焦点才能触发 onKeyDown
  useEffect(() => {
    if (focusedId && containerRef.current && document.activeElement !== containerRef.current) {
      containerRef.current.focus();
    }
  }, [focusedId]);

  // ── 渲染 ──
  if (visibleRows.length === 0) {
    return (
      <div
        style={styles.container}
        onContextMenu={(e) => handleContextMenu(null, e)}
        onDragOver={(e) => handleDragOverFolder(null, e)}
        onDragLeave={(e) => handleDragLeaveFolder(null, e)}
        onDrop={(e) => handleDropOnFolder(null, e)}
      >
        <div style={styles.empty}>{emptyText}</div>
        {menuState && <ContextMenu {...menuState} onClose={closeMenu} />}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={styles.container}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onContextMenu={(e) => {
        // 仅在空白处触发"空白右键"
        if (e.target === e.currentTarget) handleContextMenu(null, e);
      }}
      onDragOver={(e) => {
        // 拖到容器空白 = 拖到根
        if (e.target === e.currentTarget) handleDragOverFolder(null, e);
      }}
      onDrop={(e) => {
        if (e.target === e.currentTarget) handleDropOnFolder(null, e);
      }}
    >
      {visibleRows.map(({ node, depth }) => {
        const isSelected = selectedIds.has(node.id);
        const isHovered = hoveredId === node.id;
        const isDropTarget = node.kind === 'folder' && dragHoverFolderId === node.id;

        const rowStyle: CSSProperties = {
          ...styles.row,
          paddingLeft: 8 + depth * TREE_INDENT_PX,
          ...(isHovered && !isSelected ? styles.rowHover : {}),
          ...(isSelected ? styles.rowSelected : {}),
          ...(isDropTarget ? styles.rowDropTarget : {}),
        };

        const handlers = {
          onClick: (e: React.MouseEvent) => handleClick(node, e),
          onDoubleClick: () => handleDoubleClick(node),
          onContextMenu: (e: React.MouseEvent) => handleContextMenu(node, e),
          onMouseEnter: () => setHoveredId(node.id),
          onMouseLeave: () => setHoveredId(null),
          ...(draggable
            ? {
                draggable: true,
                onDragStart: (e: React.DragEvent) => handleDragStart(node, e),
                ...(node.kind === 'folder'
                  ? {
                      onDragOver: (e: React.DragEvent) => handleDragOverFolder(node, e),
                      onDragLeave: (e: React.DragEvent) => handleDragLeaveFolder(node, e),
                      onDrop: (e: React.DragEvent) => handleDropOnFolder(node, e),
                    }
                  : {}),
              }
            : {}),
        };

        if (node.kind === 'folder') {
          return (
            <div key={node.id} style={rowStyle} {...handlers}>
              <span
                style={styles.caret}
                onClick={(e) => handleCaretClick(node, e)}
                title={node.expanded ? '折叠' : '展开'}
              >
                {node.expanded ? '▾' : '▸'}
              </span>
              <span style={styles.icon}>📁</span>
              <span style={styles.title}>{node.title}</span>
            </div>
          );
        }

        // item
        const meta = itemMeta(node);
        return (
          <div key={node.id} style={rowStyle} {...handlers}>
            <span style={styles.caret}></span>
            <span style={styles.icon}>{meta.icon}</span>
            <span style={styles.title}>{meta.title}</span>
            {meta.rightHint && <span style={styles.rightHint}>{meta.rightHint}</span>}
          </div>
        );
      })}
      {menuState && <ContextMenu {...menuState} onClose={closeMenu} />}
    </div>
  );
}

// 兼容 ItemNode 单独 import 场景（其他模块可能用）
export type { TreeNode, FolderNode, ItemNode };
