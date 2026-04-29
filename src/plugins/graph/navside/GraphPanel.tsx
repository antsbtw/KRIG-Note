/**
 * GraphPanel — Graph 工作模式的 NavSide 内容面板
 *
 * 与 NotePanel / EBookPanel 同形态:消费 FolderTree + useGraphOperations,
 * 监听 'navside:action' 事件响应 actionBar 点击。
 *
 * NavSide.tsx 通过 panel-registry.getNavPanel('graph-list') 拿到本组件渲染。
 */
import { useEffect, useMemo } from 'react';
import { FolderTree } from '../../../renderer/navside/components/FolderTree';
import type { ItemNode } from '../../../renderer/navside/components/FolderTree';
import { useGraphOperations } from './useGraphOperations';
import type { GraphCanvasListItem } from '../../../shared/types/graph-types';

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? '昨天' : `${days}天前`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}周前`;
  return new Date(ts).toLocaleDateString();
}

/** Variant 图标(v1 仅 canvas;M2 加 family-tree / knowledge / mindmap 时各自图标) */
const VARIANT_ICONS: Record<string, string> = {
  'canvas': '🎨',
  'family-tree': '🌳',
  'knowledge': '🕸',
  'mindmap': '💭',
};

export function GraphPanel() {
  const ops = useGraphOperations();

  // 监听 NavSide ActionBar 点击
  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<{ contentType: string; actionId: string }>;
      if (ev.detail.contentType !== 'graph-list') return;
      switch (ev.detail.actionId) {
        case 'create-canvas':
          ops.handleCreateCanvas(null);
          break;
        case 'create-folder':
          ops.handleCreateFolder(null);
          break;
      }
    };
    window.addEventListener('navside:action', handler as EventListener);
    return () => window.removeEventListener('navside:action', handler as EventListener);
  }, [ops]);

  const itemMeta = useMemo(
    () => (item: ItemNode) => {
      const g = item.payload as GraphCanvasListItem;
      return {
        icon: VARIANT_ICONS[g.variant] ?? '🎨',
        title: g.title || '未命名画板',
        rightHint: relativeTime(g.updated_at),
      };
    },
    [],
  );

  return (
    <FolderTree
      nodes={ops.nodes}
      selectedIds={ops.selectedIds}
      onSelectChange={ops.setSelectedIds}
      onFolderToggle={ops.handleFolderToggle}
      itemMeta={itemMeta}
      onItemClick={(item) => ops.handleItemClick(item)}
      onItemDoubleClick={(item) => ops.startRename(item.id)}
      contextMenu={(target) => ops.buildContextMenu(target)}
      draggable
      onDrop={ops.handleDrop}
      onKeyAction={ops.handleKeyAction}
      renamingId={ops.renamingId}
      renamingValue={ops.renameValue}
      onRenamingChange={ops.setRenameValue}
      onRenameCommit={ops.commitRename}
      onRenameCancel={ops.cancelRename}
      emptyText="暂无画板,点击上方 + 画板 创建"
    />
  );
}
