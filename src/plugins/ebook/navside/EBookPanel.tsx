/**
 * EBookPanel — eBook 工作模式的 NavSide 内容面板（v1.4 NavSide 重构 M4）。
 *
 * 消费 FolderTree + useEBookOperations，零业务逻辑硬编码进框架。
 * NavSide.tsx 通过 panel-registry.getNavPanel('ebook-bookshelf') 拿到本组件渲染。
 *
 * 与 NotePanel / GraphPanel 同形态：
 * - itemMeta 按 fileType 选 icon
 * - 拖拽 / 重命名 / 右键菜单 由 FolderTree 内置 + ops 业务回调
 * - EBook 独有：导入弹窗 + 打开失败 toast
 */
import { useEffect, useMemo } from 'react';
import { FolderTree } from '../../../renderer/navside/components/FolderTree';
import type { ItemNode } from '../../../renderer/navside/components/FolderTree';
import { useEBookOperations } from './useEBookOperations';
import { ImportModal } from './ImportModal';
import type { EBookEntry } from './useEBookSync';

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

export function EBookPanel() {
  const ops = useEBookOperations();

  // 监听 NavSide ActionBar 点击（v1.4 plugin 自治模式）
  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<{ contentType: string; actionId: string }>;
      if (ev.detail.contentType !== 'ebook-bookshelf') return;
      switch (ev.detail.actionId) {
        case 'create-ebook-folder':
          ops.handleCreateFolder();
          break;
        case 'import-ebook':
          void ops.handleImport();
          break;
      }
    };
    window.addEventListener('navside:action', handler as EventListener);
    return () => window.removeEventListener('navside:action', handler as EventListener);
  }, [ops]);

  // toast 自动消失
  useEffect(() => {
    if (!ops.toast) return;
    const t = setTimeout(() => ops.dismissToast(), 4000);
    return () => clearTimeout(t);
  }, [ops]);

  const itemMeta = useMemo(
    () => (item: ItemNode) => {
      const book = item.payload as EBookEntry;
      return {
        icon: ops.fileIcon(book.fileType),
        title: book.displayName || '未命名',
        rightHint: relativeTime(book.lastOpenedAt),
      };
    },
    [ops],
  );

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
        emptyText="点击上方 + 导入 添加电子书"
      />
      {ops.importModal && (
        <ImportModal
          fileName={ops.importModal.fileName}
          storage={ops.importStorage}
          onStorageChange={ops.setImportStorage}
          onConfirm={ops.handleImportConfirm}
          onCancel={ops.cancelImport}
        />
      )}
      {ops.toast && (
        <div style={toastStyle} onClick={() => ops.dismissToast()}>
          {ops.toast}
        </div>
      )}
    </>
  );
}

const toastStyle: React.CSSProperties = {
  position: 'absolute',
  left: '12px',
  right: '12px',
  bottom: '12px',
  background: '#5a2222',
  border: '1px solid #a04040',
  color: '#ffd6d6',
  fontSize: '12px',
  lineHeight: 1.4,
  padding: '8px 10px',
  borderRadius: '4px',
  cursor: 'pointer',
  zIndex: 100,
  boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
};
