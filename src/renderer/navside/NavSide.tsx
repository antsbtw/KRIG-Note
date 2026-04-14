import { useEffect, useRef } from 'react';
import { getNavPanel } from './panel-registry';
import { useWorkspaceSync } from './hooks/useWorkspaceSync';
import { useNoteOperations } from './hooks/useNoteOperations';
import { useDragAndDrop } from './hooks/useDragAndDrop';
import { styles } from './navside-styles';

// ── 相对时间 ──

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

// ── 主组件 ──

export function NavSide() {
  const ws = useWorkspaceSync();
  const ops = useNoteOperations({
    noteList: ws.noteList,
    folderList: ws.folderList,
    activeNoteId: ws.activeNoteId,
    expandedFolders: ws.expandedFolders,
    setActiveNoteId: ws.setActiveNoteId,
    setExpandedFolders: ws.setExpandedFolders,
  });
  const dnd = useDragAndDrop({
    noteList: ws.noteList,
    folderList: ws.folderList,
    setExpandedFolders: ws.setExpandedFolders,
  });

  // ── 右键菜单位置自适应 ──

  const contextMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ops.contextMenu || !contextMenuRef.current) return;
    const el = contextMenuRef.current;
    requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = ops.contextMenu!.x;
      let top = ops.contextMenu!.y;
      if (left + rect.width > vw) left = Math.max(4, ops.contextMenu!.x - rect.width);
      if (top + rect.height > vh) top = Math.max(4, ops.contextMenu!.y - rect.height);
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    });
  }, [ops.contextMenu]);

  // ── 树形构建 ──

  function buildTree(parentId: string | null, depth: number): React.ReactNode[] {
    const folders = ws.folderList
      .filter((f) => f.parent_id === parentId)
      .sort((a, b) => a.sort_order - b.sort_order);
    const notes = ws.noteList.filter((n) => n.folder_id === parentId);
    const nodes: React.ReactNode[] = [];

    for (const folder of folders) {
      const isExpanded = ws.expandedFolders.has(folder.id);
      const childNoteCount = ws.noteList.filter((n) => n.folder_id === folder.id).length;
      const childFolderCount = ws.folderList.filter((f) => f.parent_id === folder.id).length;
      const totalChildren = childNoteCount + childFolderCount;
      const folderKey = `f:${folder.id}`;
      const isFolderSelected = ops.selectedItems.has(folderKey);

      nodes.push(
        <div key={`f-${folder.id}`}>
          <div
            draggable
            onDragStart={(e) => dnd.handleDragStart(e, 'folder', folder.id)}
            onDragEnd={dnd.handleDragEnd}
            style={{
              ...styles.folderItem,
              paddingLeft: `${12 + depth * 16}px`,
              ...(isFolderSelected ? styles.multiSelected : {}),
              ...(dnd.dropTargetId === folder.id ? styles.dropTarget : {}),
              ...(dnd.dragItem?.type === 'folder' && dnd.dragItem.id === folder.id ? styles.dragging : {}),
            }}
            onClick={(e) => ops.handleClickFolder(e, folder.id)}
            onDoubleClick={() => ops.startRename('folder', folder.id)}
            onContextMenu={(e) => ops.handleContextMenu(e, 'folder', folder.id)}
            onMouseEnter={(e) => {
              if (!dnd.dragItem && dnd.dropTargetId !== folder.id) e.currentTarget.style.background = '#2a2a2a';
            }}
            onMouseLeave={(e) => {
              if (!dnd.dragItem && dnd.dropTargetId !== folder.id) e.currentTarget.style.background = '';
            }}
            onDragOver={(e) => dnd.handleDragOver(e, folder.id)}
            onDragLeave={(e) => dnd.handleDragLeave(e, folder.id)}
            onDrop={(e) => dnd.handleDrop(e, folder.id)}
          >
            <span style={styles.folderToggle}>{isExpanded ? '▾' : '▸'}</span>
            <span style={styles.folderIcon}>{(isExpanded || dnd.dropTargetId === folder.id) ? '📂' : '📁'}</span>
            {ops.renamingId === folder.id ? (
              <input
                ref={ops.renameInputRef}
                style={styles.renameInput}
                value={ops.renameValue}
                onChange={(e) => ops.setRenameValue(e.target.value)}
                onBlur={ops.commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') ops.commitRename();
                  if (e.key === 'Escape') ops.setRenamingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <span style={styles.folderTitle}>{folder.title}</span>
                {totalChildren > 0 && (
                  <span style={styles.folderCount}>{totalChildren}</span>
                )}
              </>
            )}
          </div>
          {isExpanded && buildTree(folder.id, depth + 1)}
        </div>,
      );
    }

    for (const note of notes) {
      const noteKey = `n:${note.id}`;
      const isNoteSelected = ops.selectedItems.has(noteKey);

      nodes.push(
        <div
          key={`n-${note.id}`}
          draggable
          onDragStart={(e) => dnd.handleDragStart(e, 'note', note.id)}
          onDragEnd={dnd.handleDragEnd}
          style={{
            ...styles.noteItem,
            paddingLeft: `${12 + depth * 16 + (parentId ? 16 : 0)}px`,
            ...(note.id === ws.activeNoteId && !isNoteSelected ? styles.noteItemActive : {}),
            ...(isNoteSelected ? styles.multiSelected : {}),
            ...(dnd.dragItem?.type === 'note' && dnd.dragItem.id === note.id ? styles.dragging : {}),
          }}
          onClick={(e) => ops.handleClickNote(e, note.id)}
          onDoubleClick={() => ops.startRename('note', note.id)}
          onContextMenu={(e) => ops.handleContextMenu(e, 'note', note.id, note.folder_id)}
          onMouseEnter={(e) => {
            if (note.id !== ws.activeNoteId && !isNoteSelected) e.currentTarget.style.background = '#2a2a2a';
          }}
          onMouseLeave={(e) => {
            if (note.id !== ws.activeNoteId && !isNoteSelected) e.currentTarget.style.background = 'transparent';
          }}
        >
          <span style={styles.noteIcon}>📄</span>
          {ops.renamingId === note.id ? (
            <input
              ref={ops.renameInputRef}
              style={styles.renameInput}
              value={ops.renameValue}
              onChange={(e) => ops.setRenameValue(e.target.value)}
              onBlur={ops.commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') ops.commitRename();
                if (e.key === 'Escape') ops.setRenamingId(null);
              }}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              <span style={styles.noteTitle}>{note.title}</span>
              <span style={styles.noteDate}>{relativeTime(note.updated_at)}</span>
            </>
          )}
        </div>,
      );
    }

    return nodes;
  }

  // ── 右键菜单渲染 ──

  function renderContextMenu() {
    if (!ops.contextMenu) return null;
    const { type, id, folderId, isMulti } = ops.contextMenu;

    if (isMulti) {
      return (
        <div
          ref={contextMenuRef}
          style={{ ...styles.contextMenu, left: ops.contextMenu.x, top: ops.contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{ ...styles.contextMenuItem, color: '#f87171' }}
            onClick={ops.handleDeleteSelected}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#3a3a3a')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            删除 {ops.selectedItems.size} 项
          </div>
        </div>
      );
    }

    return (
      <div
        ref={contextMenuRef}
        style={{ ...styles.contextMenu, left: ops.contextMenu.x, top: ops.contextMenu.y }}
        onClick={(e) => e.stopPropagation()}
      >
        {type === 'folder' && (
          <>
            <div
              style={styles.contextMenuItem}
              onClick={() => { ops.setContextMenu(null); ops.handleCreateNote(id); }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#3a3a3a')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              新建笔记
            </div>
            <div
              style={styles.contextMenuItem}
              onClick={() => { ops.setContextMenu(null); ops.handleCreateFolder(id); }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#3a3a3a')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              新建子文件夹
            </div>
            <div style={styles.contextMenuSeparator} />
          </>
        )}
        <div
          style={styles.contextMenuItem}
          onClick={() => ops.startRename(type, id)}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#3a3a3a')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          重命名
        </div>
        {type === 'note' && folderId && (
          <div
            style={styles.contextMenuItem}
            onClick={() => ops.handleMoveOut(id)}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#3a3a3a')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            移出文件夹
          </div>
        )}
        <div style={styles.contextMenuSeparator} />
        <div
          style={{ ...styles.contextMenuItem, color: '#f87171' }}
          onClick={() => ops.handleDelete(type, id)}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#3a3a3a')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          删除
        </div>
      </div>
    );
  }

  // ── 渲染 ──

  return (
    <div style={styles.container}>
      {/* Brand Bar */}
      <div style={styles.brandBar}>
        <img src="/logo.jpg" style={styles.brandLogo} alt="KRIG" />
        <span style={styles.brandName}>KRIG</span>
      </div>

      {/* ModeBar */}
      <div style={styles.modeBar} role="tablist" aria-label="工作模式">
        {ws.modes.map((mode) => (
          <button
            key={mode.id}
            role="tab"
            aria-selected={mode.id === ws.activeWorkModeId}
            style={{
              ...styles.modeTab,
              ...(mode.id === ws.activeWorkModeId ? styles.modeTabActive : {}),
            }}
            onClick={() => ops.handleSwitchMode(mode.id)}
            title={mode.label}
            aria-label={mode.label}
          >
            <span style={styles.modeIcon}>{mode.icon}</span>
            <span style={styles.modeLabel}>{mode.label}</span>
          </button>
        ))}
      </div>

      {/* Action Bar */}
      <div style={styles.actionBar}>
        <span style={styles.actionTitle}>{ws.registration?.actionBar.title ?? ''}</span>
        <div style={styles.actionButtons}>
          {ws.registration?.actionBar.actions.map((action) => (
            <button
              key={action.id}
              style={styles.actionButton}
              onClick={() => ops.handleActionBarClick(action.id)}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div style={styles.search}>
        <input
          style={styles.searchInput}
          placeholder={
            ws.registration?.contentType === 'ebook-bookshelf' ? '搜索书架...'
            : ws.registration?.contentType === 'web-bookmarks' ? '搜索书签...'
            : '搜索笔记...'
          }
          readOnly
        />
      </div>

      {/* Content — note-list 内置面板 */}
      {ws.registration?.contentType === 'note-list' && (
        <>
          <div
            style={{
              ...styles.contentList,
              ...(dnd.dropTargetId === 'root' ? styles.dropTargetRoot : {}),
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) ops.setSelectedItems(new Set());
            }}
            onDragOver={(e) => dnd.handleDragOver(e, 'root')}
            onDragLeave={(e) => dnd.handleDragLeave(e, 'root')}
            onDrop={(e) => dnd.handleDrop(e, null)}
          >
            {!ws.dbReady ? (
              <div style={styles.placeholder}>数据库启动中...</div>
            ) : ws.noteList.length === 0 && ws.folderList.length === 0 ? (
              <div style={styles.placeholder}>暂无笔记</div>
            ) : (
              buildTree(null, 0)
            )}
          </div>
          {renderContextMenu()}
        </>
      )}

      {/* 插件面板：通过注册表动态分发 */}
      {ws.registration?.contentType && ws.registration.contentType !== 'note-list' && (() => {
        const PanelComponent = getNavPanel(ws.registration!.contentType);
        if (!PanelComponent) return null;
        return (
          <PanelComponent
            activeBookId={ws.activeBookId}
            initialExpandedFolders={ws.ebookExpandedFolders}
            onActiveBookChange={ws.setActiveBookId}
            dbReady={ws.dbReady}
          />
        );
      })()}
    </div>
  );
}
