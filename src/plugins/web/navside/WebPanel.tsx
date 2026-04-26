/**
 * WebPanel — Web 工作模式的 NavSide 内容面板（v1.4 NavSide 重构 M5）。
 *
 * 消费 FolderTree + useWebOperations，向 Note 看齐：
 * - 嵌套文件夹 + 拖拽 + 重命名 + 右键菜单
 * - 书签 icon 优先 favicon，缺省 🌐
 *
 * 注意：NavSide 不负责"添加书签"——加书签由 WebView 内的⭐流程触发。
 */
import { useEffect, useMemo } from 'react';
import { FolderTree } from '../../../renderer/navside/components/FolderTree';
import type { ItemNode } from '../../../renderer/navside/components/FolderTree';
import { useWebOperations } from './useWebOperations';
import type { WebBookmark } from './useWebSync';

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

function FaviconIcon({ url, fallback }: { url?: string; fallback: string }) {
  if (!url) return <span>{fallback}</span>;
  return (
    <img
      src={url}
      style={{ width: 14, height: 14, display: 'inline-block', verticalAlign: 'middle' }}
      onError={(e) => {
        // favicon 加载失败回退到 emoji
        (e.currentTarget as HTMLImageElement).style.display = 'none';
        const sib = (e.currentTarget.nextSibling as HTMLElement | null);
        if (sib) sib.style.display = 'inline';
      }}
      alt=""
    />
  );
}

export function WebPanel() {
  const ops = useWebOperations();

  // 监听 NavSide ActionBar 点击（v1.4 plugin 自治模式）
  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<{ contentType: string; actionId: string }>;
      if (ev.detail.contentType !== 'web-bookmarks') return;
      switch (ev.detail.actionId) {
        case 'create-web-folder':
          ops.handleCreateFolder();
          break;
      }
    };
    window.addEventListener('navside:action', handler as EventListener);
    return () => window.removeEventListener('navside:action', handler as EventListener);
  }, [ops]);

  const itemMeta = useMemo(
    () => (item: ItemNode) => {
      const bk = item.payload as WebBookmark;
      return {
        icon: <FaviconIcon url={bk.favicon} fallback="🌐" />,
        title: bk.title || bk.url,
        rightHint: relativeTime(bk.createdAt),
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
      emptyText="还没有书签。在网页页面里点⭐添加。"
    />
  );
}
