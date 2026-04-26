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
import { useGraphOperations, AVAILABLE_VARIANTS, type VariantId } from './useGraphOperations';
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

  // VariantPicker 浮层状态
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);

  // 监听 ActionBar 创建按钮（NavSide 转发的 'create-graph' executeAction）
  // 实际上 v1.4 重构后 ActionBar 的 "+ 新建" 直接通过自定义 DOM 事件触发本组件
  // 因为 ActionBar 不知道 variant 概念。
  // 暂时方案：监听 click 事件 dispatch 给 NavSide 时 ActionBar 走默认 executeAction，
  // 我们在 NavSide 重写 ActionBar 渲染时注入回调（M3 这一步）。
  // 为了让 v1.3 行为继续工作，这里也监听 'graph:variant-picker:open' 事件作为入口。
  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<HTMLElement>;
      setPickerAnchor(ev.detail);
    };
    window.addEventListener('graph:variant-picker:open', handler as EventListener);
    return () => window.removeEventListener('graph:variant-picker:open', handler as EventListener);
  }, []);

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

  // 暂时也支持顶部按钮：如果 NavSide 暴露了挂载点（M3 后续完成），
  // 这里渲染 inline picker；否则不渲染（用户走右键创建）
  void AVAILABLE_VARIANTS;

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
