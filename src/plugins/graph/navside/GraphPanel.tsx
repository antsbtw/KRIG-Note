/**
 * GraphPanel — Graph 工作模式的 NavSide 内容面板（v1.4 NavSide 重构 M3）。
 *
 * 消费 FolderTree + useGraphOperations，所有业务逻辑下沉到插件 hook。
 * NavSide.tsx 通过 panel-registry.getNavPanel('graph-list') 拿到本组件渲染。
 *
 * 与 NotePanel 同形态：
 * - itemMeta 按 variant 选 icon
 * - 拖拽 / 重命名 / 右键菜单 由 FolderTree 内置 + ops 业务回调
 */
import { useEffect, useMemo, useState } from 'react';
import { FolderTree } from '../../../renderer/navside/components/FolderTree';
import type { ItemNode } from '../../../renderer/navside/components/FolderTree';
import { useGraphOperations, type VariantId } from './useGraphOperations';
import { VariantPicker } from './VariantPicker';
import type { GraphListItem } from './useGraphSync';

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

export function GraphPanel() {
  const ops = useGraphOperations();

  // VariantPicker 浮层状态：点 "+ 图谱" 时弹出选 variant
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);

  // 监听 NavSide ActionBar 点击（v1.4 plugin 自治模式）
  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<{ contentType: string; actionId: string; target: HTMLElement }>;
      if (ev.detail.contentType !== 'graph-list') return;
      switch (ev.detail.actionId) {
        case 'create-folder':
          ops.handleCreateFolder();
          break;
        case 'create-graph':
          // "+ 图谱" 仍弹 VariantPicker 选 variant
          setPickerAnchor(ev.detail.target);
          break;
      }
    };
    window.addEventListener('navside:action', handler as EventListener);
    return () => window.removeEventListener('navside:action', handler as EventListener);
  }, [ops]);

  const itemMeta = useMemo(
    () => (item: ItemNode) => {
      const g = item.payload as GraphListItem;
      return {
        icon: ops.variantIcon(g.variant),
        title: g.title || '未命名图谱',
        rightHint: relativeTime(g.updated_at),
      };
    },
    [ops],
  );

  const handlePickVariant = (variant: VariantId) => {
    ops.handleCreateGraph(variant, null);
  };

  return (
    <>
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
        emptyText="暂无图谱。右键空白处新建。"
      />
      {pickerAnchor && (
        <VariantPicker
          anchor={pickerAnchor}
          onPick={handlePickVariant}
          onClose={() => setPickerAnchor(null)}
        />
      )}
    </>
  );
}
