/**
 * NotePanel — Note 工作模式的 NavSide 内容面板（v1.4 NavSide 重构）。
 *
 * 消费 FolderTree + useNoteOperations，零业务逻辑硬编码进框架。
 * NavSide.tsx 通过 panel-registry.getNavPanel('note-list') 拿到本组件渲染。
 */
import { useEffect, useMemo } from 'react';
import { FolderTree } from '../../../renderer/navside/components/FolderTree';
import type { ItemNode } from '../../../renderer/navside/components/FolderTree';
import { useNoteOperations } from './useNoteOperations';
import type { NoteListItem } from './useNoteSync';

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

interface NotePanelProps {
  /** 框架透传：当前 db 是否就绪 */
  dbReady?: boolean;
}

export function NotePanel(_props: NotePanelProps) {
  const ops = useNoteOperations();

  // 监听 NavSide ActionBar 点击（v1.4 plugin 自治模式）
  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<{ contentType: string; actionId: string }>;
      if (ev.detail.contentType !== 'note-list') return;
      switch (ev.detail.actionId) {
        case 'create-note': ops.handleCreateNote(); break;
        case 'create-folder': ops.handleCreateFolder(); break;
      }
    };
    window.addEventListener('navside:action', handler as EventListener);
    return () => window.removeEventListener('navside:action', handler as EventListener);
  }, [ops]);

  const itemMeta = useMemo(
    () => (item: ItemNode) => {
      const note = item.payload as NoteListItem;
      return {
        icon: '📄',
        title: note.title || '未命名',
        rightHint: relativeTime(note.updated_at),
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
      emptyText="暂无笔记"
    />
  );
}
