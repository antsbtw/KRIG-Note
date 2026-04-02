import { useState, useEffect, useCallback, useRef } from 'react';
import type { WorkModeRegistration } from '../../shared/types';

// ── 数据类型 ──

interface NoteListItem {
  id: string;
  title: string;
  folder_id: string | null;
  updated_at: number;
}

interface FolderRecord {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  created_at: number;
}

// ── NavSide API ──

declare const navSideAPI: {
  listWorkModes: () => Promise<WorkModeRegistration[]>;
  switchWorkMode: (id: string) => Promise<void>;
  toggle: () => Promise<void>;
  openRightSlot: (workModeId: string) => Promise<void>;
  closeRightSlot: () => Promise<void>;
  noteCreate: (title?: string, folderId?: string | null) => Promise<any>;
  noteList: () => Promise<NoteListItem[]>;
  noteDelete: (id: string) => Promise<void>;
  noteRename: (id: string, title: string) => Promise<void>;
  noteMoveToFolder: (noteId: string, folderId: string | null) => Promise<void>;
  noteOpenInEditor: (id: string) => Promise<void>;
  onNoteListChanged: (callback: (list: NoteListItem[]) => void) => () => void;
  folderCreate: (title: string, parentId?: string | null) => Promise<any>;
  folderRename: (id: string, title: string) => Promise<void>;
  folderDelete: (id: string) => Promise<void>;
  folderMove: (id: string, parentId: string | null) => Promise<void>;
  folderList: () => Promise<FolderRecord[]>;
  isDBReady: () => Promise<boolean>;
  onDBReady: (callback: () => void) => () => void;
  getActiveState: () => Promise<{ workspaces: unknown[]; activeId: string | null; active?: { workModeId: string; activeNoteId?: string | null; expandedFolders?: string[] } }>;
  setExpandedFolders: (folderIds: string[]) => Promise<void>;
  onRestoreWorkspaceState: (callback: (state: { activeNoteId: string | null; expandedFolders: string[] }) => void) => () => void;
  onStateChanged: (callback: (state: unknown) => void) => () => void;
  resizeStart: (screenX: number) => void;
  resizeMove: (screenX: number) => void;
  resizeEnd: () => void;
};

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
  const [modes, setModes] = useState<WorkModeRegistration[]>([]);
  const [activeWorkModeId, setActiveWorkModeId] = useState<string>('');
  const [noteList, setNoteList] = useState<NoteListItem[]>([]);
  const [folderList, setFolderList] = useState<FolderRecord[]>([]);
  const [dbReady, setDbReady] = useState(false);

  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // 多选
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set()); // "n:noteId" or "f:folderId"
  const lastClickedRef = useRef<string | null>(null); // 上一次点击的 item key

  // 右键菜单
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number;
    type: 'note' | 'folder';
    id: string;
    folderId?: string | null;
    isMulti?: boolean; // 多选模式
  } | null>(null);

  // 重命名
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingType, setRenamingType] = useState<'note' | 'folder'>('note');
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // 拖拽（笔记或文件夹）
  const [dragItem, setDragItem] = useState<{ type: 'note' | 'folder'; id: string } | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null); // folder id 或 'root'

  // ── 数据加载 ──

  const fetchAll = useCallback(() => {
    navSideAPI.noteList().then(setNoteList);
    navSideAPI.folderList().then(setFolderList);
  }, []);

  useEffect(() => {
    navSideAPI.listWorkModes().then(setModes);

    navSideAPI.getActiveState().then((data) => {
      if (data.active) {
        setActiveWorkModeId((data.active as any).workModeId);
        // 恢复 Workspace 的 NavSide 状态
        if ((data.active as any).activeNoteId) setActiveNoteId((data.active as any).activeNoteId);
        if ((data.active as any).expandedFolders) setExpandedFolders(new Set((data.active as any).expandedFolders));
      }
    });

    const unsubState = navSideAPI.onStateChanged((data: unknown) => {
      const d = data as { active?: { workModeId: string; activeNoteId?: string | null } };
      if (d.active) {
        setActiveWorkModeId(d.active.workModeId);
        if (d.active.activeNoteId !== undefined) setActiveNoteId(d.active.activeNoteId);
      }
    });

    // noteList 变更时重新加载全部（folder 可能也变了）
    const unsubNoteList = navSideAPI.onNoteListChanged(() => {
      fetchAll();
    });

    const unsubDB = navSideAPI.onDBReady(() => {
      setDbReady(true);
      fetchAll();
    });

    navSideAPI.isDBReady().then((ready: boolean) => {
      if (ready) { setDbReady(true); fetchAll(); }
    });

    // Workspace 切换 → 恢复 NavSide 状态
    const unsubRestore = navSideAPI.onRestoreWorkspaceState((state) => {
      if (state.activeNoteId !== undefined) setActiveNoteId(state.activeNoteId);
      if (state.expandedFolders) setExpandedFolders(new Set(state.expandedFolders));
    });

    return () => { unsubState(); unsubNoteList(); unsubDB(); unsubRestore(); };
  }, [fetchAll]);

  // 同步 expandedFolders 到 Workspace
  useEffect(() => {
    navSideAPI.setExpandedFolders(Array.from(expandedFolders));
  }, [expandedFolders]);

  // 右键菜单：点击空白关闭
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  // 重命名自动聚焦
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  // ── 操作 ──

  const handleSwitchMode = useCallback((id: string) => {
    navSideAPI.switchWorkMode(id);
  }, []);

  const handleCreateNote = useCallback((folderId?: string | null) => {
    navSideAPI.noteCreate(undefined, folderId).then((note: any) => {
      if (note?.id) {
        setActiveNoteId(note.id);
        navSideAPI.noteOpenInEditor(note.id);
      }
    });
  }, []);

  const handleCreateFolder = useCallback((parentId?: string | null) => {
    navSideAPI.folderCreate('新建文件夹', parentId).then((folder: any) => {
      if (folder?.id) {
        // 自动展开父文件夹
        if (parentId) setExpandedFolders((s) => new Set(s).add(parentId));
        // 自动进入重命名
        setRenamingId(folder.id);
        setRenamingType('folder');
        setRenameValue('新建文件夹');
      }
    });
  }, []);

  // 构建扁平可见项列表（用于 Shift+Click 范围选择）
  const buildVisibleKeys = useCallback((): string[] => {
    const keys: string[] = [];
    function walk(parentId: string | null) {
      const folders = folderList.filter((f) => f.parent_id === parentId).sort((a, b) => a.sort_order - b.sort_order);
      const notes = noteList.filter((n) => n.folder_id === parentId);
      for (const folder of folders) {
        keys.push(`f:${folder.id}`);
        if (expandedFolders.has(folder.id)) walk(folder.id);
      }
      for (const note of notes) {
        keys.push(`n:${note.id}`);
      }
    }
    walk(null);
    return keys;
  }, [folderList, noteList, expandedFolders]);

  // 多选点击处理
  const handleItemClick = useCallback((e: React.MouseEvent, key: string, noteId?: string) => {
    e.stopPropagation();

    if (e.metaKey || e.ctrlKey) {
      // Cmd+Click：追加/取消选中
      e.preventDefault();
      setSelectedItems((s) => {
        const next = new Set(s);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
      });
      lastClickedRef.current = key;
      return;
    }

    if (e.shiftKey && lastClickedRef.current) {
      // Shift+Click：范围选中
      e.preventDefault();
      const keys = buildVisibleKeys();
      const fromIdx = keys.indexOf(lastClickedRef.current);
      const toIdx = keys.indexOf(key);
      if (fromIdx >= 0 && toIdx >= 0) {
        const start = Math.min(fromIdx, toIdx);
        const end = Math.max(fromIdx, toIdx);
        const range = keys.slice(start, end + 1);
        setSelectedItems(new Set(range));
      }
      return;
    }

    // 普通点击：清除多选，选中当前
    setSelectedItems(new Set());
    lastClickedRef.current = key;

    // 如果是笔记，打开
    if (noteId) {
      setActiveNoteId(noteId);
      navSideAPI.noteOpenInEditor(noteId);
    }
  }, [buildVisibleKeys]);

  const handleClickNote = useCallback((e: React.MouseEvent, noteId: string) => {
    handleItemClick(e, `n:${noteId}`, noteId);
  }, [handleItemClick]);

  const handleClickFolder = useCallback((e: React.MouseEvent, folderId: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      handleItemClick(e, `f:${folderId}`);
    } else {
      // 普通点击：展开/折叠
      setSelectedItems(new Set());
      lastClickedRef.current = `f:${folderId}`;
      setExpandedFolders((s) => {
        const next = new Set(s);
        if (next.has(folderId)) next.delete(folderId); else next.add(folderId);
        return next;
      });
    }
  }, [handleItemClick]);

  const toggleFolder = useCallback((folderId: string) => {
    setExpandedFolders((s) => {
      const next = new Set(s);
      if (next.has(folderId)) next.delete(folderId); else next.add(folderId);
      return next;
    });
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, type: 'note' | 'folder', id: string, folderId?: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    const key = type === 'note' ? `n:${id}` : `f:${id}`;
    const isMulti = selectedItems.size > 1 && selectedItems.has(key);
    setContextMenu({ x: e.clientX, y: e.clientY, type, id, folderId, isMulti });
  }, [selectedItems]);

  const handleDelete = useCallback((type: 'note' | 'folder', id: string) => {
    setContextMenu(null);
    if (type === 'note') {
      navSideAPI.noteDelete(id);
      if (activeNoteId === id) setActiveNoteId(null);
    } else {
      navSideAPI.folderDelete(id);
    }
  }, [activeNoteId]);

  const handleDeleteSelected = useCallback(() => {
    setContextMenu(null);
    for (const key of selectedItems) {
      const [type, id] = [key.slice(0, 1), key.slice(2)];
      if (type === 'n') {
        navSideAPI.noteDelete(id);
        if (activeNoteId === id) setActiveNoteId(null);
      } else {
        navSideAPI.folderDelete(id);
      }
    }
    setSelectedItems(new Set());
  }, [selectedItems, activeNoteId]);

  const startRename = useCallback((type: 'note' | 'folder', id: string) => {
    setContextMenu(null);
    const item = type === 'note'
      ? noteList.find((n) => n.id === id)
      : folderList.find((f) => f.id === id);
    setRenamingId(id);
    setRenamingType(type);
    setRenameValue(item?.title || '');
  }, [noteList, folderList]);

  const commitRename = useCallback(() => {
    if (renamingId && renameValue.trim()) {
      if (renamingType === 'note') {
        navSideAPI.noteRename(renamingId, renameValue.trim());
      } else {
        navSideAPI.folderRename(renamingId, renameValue.trim());
      }
    }
    setRenamingId(null);
  }, [renamingId, renamingType, renameValue]);

  const handleMoveOut = useCallback((noteId: string) => {
    setContextMenu(null);
    navSideAPI.noteMoveToFolder(noteId, null);
  }, []);

  // ── 拖拽 ──

  const handleDragStart = useCallback((e: React.DragEvent, type: 'note' | 'folder', id: string) => {
    setDragItem({ type, id });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `${type}:${id}`);
    // 半透明拖拽预览
    if (e.currentTarget instanceof HTMLElement) {
      e.dataTransfer.setDragImage(e.currentTarget, 10, 10);
    }
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragItem(null);
    setDropTargetId(null);
  }, []);

  // 检查文件夹是否是另一个文件夹的后代（防止循环嵌套）
  const isDescendant = useCallback((parentId: string, childId: string): boolean => {
    let current = childId;
    const visited = new Set<string>();
    while (current) {
      if (visited.has(current)) return false;
      visited.add(current);
      if (current === parentId) return true;
      const folder = folderList.find((f) => f.id === current);
      if (!folder?.parent_id) return false;
      current = folder.parent_id;
    }
    return false;
  }, [folderList]);

  const handleDragOver = useCallback((e: React.DragEvent, targetId: string) => {
    if (!dragItem) return;
    // 不能拖到自己身上
    if (dragItem.type === 'folder' && dragItem.id === targetId) return;
    // 不能把文件夹拖到自己的子文件夹
    if (dragItem.type === 'folder' && targetId !== 'root' && isDescendant(dragItem.id, targetId)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetId(targetId);
  }, [dragItem, isDescendant]);

  const handleDragLeave = useCallback((e: React.DragEvent, targetId: string) => {
    if (dropTargetId === targetId && !e.currentTarget.contains(e.relatedTarget as Node)) {
      setDropTargetId(null);
    }
  }, [dropTargetId]);

  const handleDrop = useCallback((e: React.DragEvent, targetFolderId: string | null) => {
    e.preventDefault();
    if (!dragItem) return;

    if (dragItem.type === 'note') {
      const note = noteList.find((n) => n.id === dragItem.id);
      if (note && note.folder_id !== targetFolderId) {
        navSideAPI.noteMoveToFolder(dragItem.id, targetFolderId);
        if (targetFolderId) setExpandedFolders((s) => new Set(s).add(targetFolderId));
      }
    } else {
      // 文件夹移动
      const folder = folderList.find((f) => f.id === dragItem.id);
      if (folder && folder.parent_id !== targetFolderId) {
        // 防止循环嵌套
        if (!targetFolderId || !isDescendant(dragItem.id, targetFolderId)) {
          navSideAPI.folderMove(dragItem.id, targetFolderId);
          if (targetFolderId) setExpandedFolders((s) => new Set(s).add(targetFolderId));
        }
      }
    }

    setDragItem(null);
    setDropTargetId(null);
  }, [dragItem, noteList, folderList, isDescendant]);

  // ── 树形构建 ──

  function buildTree(parentId: string | null, depth: number): React.ReactNode[] {
    const folders = folderList
      .filter((f) => f.parent_id === parentId)
      .sort((a, b) => a.sort_order - b.sort_order);

    const notes = noteList.filter((n) => n.folder_id === parentId);

    const nodes: React.ReactNode[] = [];

    for (const folder of folders) {
      const isExpanded = expandedFolders.has(folder.id);
      const childNoteCount = noteList.filter((n) => n.folder_id === folder.id).length;
      const childFolderCount = folderList.filter((f) => f.parent_id === folder.id).length;
      const totalChildren = childNoteCount + childFolderCount;

      const folderKey = `f:${folder.id}`;
      const isFolderSelected = selectedItems.has(folderKey);

      nodes.push(
        <div key={`f-${folder.id}`}>
          <div
            draggable
            onDragStart={(e) => handleDragStart(e, 'folder', folder.id)}
            onDragEnd={handleDragEnd}
            style={{
              ...styles.folderItem,
              paddingLeft: `${12 + depth * 16}px`,
              ...(isFolderSelected ? styles.multiSelected : {}),
              ...(dropTargetId === folder.id ? styles.dropTarget : {}),
              ...(dragItem?.type === 'folder' && dragItem.id === folder.id ? styles.dragging : {}),
            }}
            onClick={(e) => handleClickFolder(e, folder.id)}
            onDoubleClick={() => startRename('folder', folder.id)}
            onContextMenu={(e) => handleContextMenu(e, 'folder', folder.id)}
            onMouseEnter={(e) => {
              if (dropTargetId !== folder.id) e.currentTarget.style.background = '#2a2a2a';
            }}
            onMouseLeave={(e) => {
              if (dropTargetId !== folder.id) e.currentTarget.style.background = 'transparent';
            }}
            onDragOver={(e) => handleDragOver(e, folder.id)}
            onDragLeave={(e) => handleDragLeave(e, folder.id)}
            onDrop={(e) => handleDrop(e, folder.id)}
          >
            <span style={styles.folderToggle}>{isExpanded ? '▾' : '▸'}</span>
            <span style={styles.folderIcon}>{isExpanded ? '📂' : '📁'}</span>
            {renamingId === folder.id ? (
              <input
                ref={renameInputRef}
                style={styles.renameInput}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setRenamingId(null);
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
      const isNoteSelected = selectedItems.has(noteKey);

      nodes.push(
        <div
          key={`n-${note.id}`}
          draggable
          onDragStart={(e) => handleDragStart(e, 'note', note.id)}
          onDragEnd={handleDragEnd}
          style={{
            ...styles.noteItem,
            paddingLeft: `${12 + depth * 16 + (parentId ? 16 : 0)}px`,
            ...(note.id === activeNoteId && !isNoteSelected ? styles.noteItemActive : {}),
            ...(isNoteSelected ? styles.multiSelected : {}),
            ...(dragItem?.type === 'note' && dragItem.id === note.id ? styles.dragging : {}),
          }}
          onClick={(e) => handleClickNote(e, note.id)}
          onDoubleClick={() => startRename('note', note.id)}
          onContextMenu={(e) => handleContextMenu(e, 'note', note.id, note.folder_id)}
          onMouseEnter={(e) => {
            if (note.id !== activeNoteId && !isNoteSelected) e.currentTarget.style.background = '#2a2a2a';
          }}
          onMouseLeave={(e) => {
            if (note.id !== activeNoteId && !isNoteSelected) e.currentTarget.style.background = 'transparent';
          }}
        >
          <span style={styles.noteIcon}>📄</span>
          {renamingId === note.id ? (
            <input
              ref={renameInputRef}
              style={styles.renameInput}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setRenamingId(null);
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

  const contextMenuRef = useRef<HTMLDivElement>(null);

  // 菜单位置自适应：右侧/底部空间不够时翻转
  useEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;
    const el = contextMenuRef.current;
    // 先用原始坐标渲染，requestAnimationFrame 后修正
    requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = contextMenu.x;
      let top = contextMenu.y;
      if (left + rect.width > vw) left = Math.max(4, contextMenu.x - rect.width);
      if (top + rect.height > vh) top = Math.max(4, contextMenu.y - rect.height);
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    });
  }, [contextMenu]);

  function renderContextMenu() {
    if (!contextMenu) return null;
    const { type, id, folderId, isMulti } = contextMenu;

    // 多选模式：只显示批量操作
    if (isMulti) {
      return (
        <div
          ref={contextMenuRef}
          style={{ ...styles.contextMenu, left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{ ...styles.contextMenuItem, color: '#f87171' }}
            onClick={handleDeleteSelected}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#3a3a3a')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            删除 {selectedItems.size} 项
          </div>
        </div>
      );
    }

    return (
      <div
        ref={contextMenuRef}
        style={{ ...styles.contextMenu, left: contextMenu.x, top: contextMenu.y }}
        onClick={(e) => e.stopPropagation()}
      >
        {type === 'folder' && (
          <>
            <div
              style={styles.contextMenuItem}
              onClick={() => { setContextMenu(null); handleCreateNote(id); }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#3a3a3a')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              新建笔记
            </div>
            <div
              style={styles.contextMenuItem}
              onClick={() => { setContextMenu(null); handleCreateFolder(id); }}
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
          onClick={() => startRename(type, id)}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#3a3a3a')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          重命名
        </div>
        {type === 'note' && folderId && (
          <div
            style={styles.contextMenuItem}
            onClick={() => handleMoveOut(id)}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#3a3a3a')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            移出文件夹
          </div>
        )}
        <div style={styles.contextMenuSeparator} />
        <div
          style={{ ...styles.contextMenuItem, color: '#f87171' }}
          onClick={() => handleDelete(type, id)}
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
      <div style={styles.modeBar}>
        {modes.map((mode) => (
          <button
            key={mode.id}
            style={{
              ...styles.modeTab,
              ...(mode.id === activeWorkModeId ? styles.modeTabActive : {}),
            }}
            onClick={() => handleSwitchMode(mode.id)}
            title={mode.label}
          >
            <span style={styles.modeIcon}>{mode.icon}</span>
            <span style={styles.modeLabel}>{mode.label}</span>
          </button>
        ))}
      </div>

      {/* Action Bar */}
      <div style={styles.actionBar}>
        <span style={styles.actionTitle}>笔记目录</span>
        <div style={styles.actionButtons}>
          <button style={styles.actionButton} title="新建文件夹" onClick={() => handleCreateFolder()}>+ 文件夹</button>
          <button style={styles.actionButton} title="新建笔记" onClick={() => handleCreateNote()}>+ 新建</button>
        </div>
      </div>

      {/* Search（占位） */}
      <div style={styles.search}>
        <input style={styles.searchInput} placeholder="搜索笔记..." readOnly />
      </div>

      {/* Content List — 树形列表 */}
      <div
        style={{
          ...styles.contentList,
          ...(dropTargetId === 'root' ? styles.dropTargetRoot : {}),
        }}
        onClick={(e) => {
          // 只在点击空白区域时清除多选（不是点击子项冒泡上来的）
          if (e.target === e.currentTarget) setSelectedItems(new Set());
        }}
        onDragOver={(e) => handleDragOver(e, 'root')}
        onDragLeave={(e) => handleDragLeave(e, 'root')}
        onDrop={(e) => handleDrop(e, null)}
      >
        {!dbReady ? (
          <div style={styles.placeholder}>数据库启动中...</div>
        ) : noteList.length === 0 && folderList.length === 0 ? (
          <div style={styles.placeholder}>暂无笔记</div>
        ) : (
          buildTree(null, 0)
        )}
      </div>

      {renderContextMenu()}
    </div>
  );
}

// ── 样式 ──

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#1a1a1a',
    color: '#e8eaed',
  },
  brandBar: {
    display: 'flex',
    alignItems: 'center',
    height: '40px',
    padding: '0 16px',
    borderBottom: '1px solid #333',
  },
  brandLogo: {
    width: '28px',
    height: '28px',
    borderRadius: '6px',
    marginRight: '10px',
    objectFit: 'cover',
  },
  brandName: {
    fontSize: '15px',
    fontWeight: 600,
    color: '#e8eaed',
  },
  modeBar: {
    display: 'flex',
    flexDirection: 'row',
    gap: '2px',
    padding: '6px 8px',
    borderBottom: '1px solid #333',
  },
  modeTab: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px',
    flex: 1,
    padding: '4px 0',
    border: 'none',
    borderRadius: '4px',
    background: 'transparent',
    color: '#999',
    fontSize: '11px',
    cursor: 'pointer',
    textAlign: 'center',
    flexDirection: 'column',
  },
  modeTabActive: {
    background: '#333',
    color: '#e8eaed',
  },
  modeIcon: { fontSize: '16px' },
  modeLabel: {},
  actionBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: '36px',
    padding: '0 16px',
    borderBottom: '1px solid #333',
  },
  actionTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#c8a96e',
    flexShrink: 0,
  },
  actionButtons: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  actionButton: {
    border: 'none',
    background: 'transparent',
    color: '#c8a96e',
    fontSize: '12px',
    cursor: 'pointer',
    padding: '2px 0',
    whiteSpace: 'nowrap',
  },
  search: {
    padding: '8px',
    borderBottom: '1px solid #333',
  },
  searchInput: {
    width: '100%',
    height: '28px',
    padding: '0 8px',
    border: '1px solid #444',
    borderRadius: '4px',
    background: '#2a2a2a',
    color: '#e8eaed',
    fontSize: '12px',
    outline: 'none',
  },
  contentList: {
    flex: 1,
    overflow: 'auto',
    padding: '4px 0 120px',
  },
  placeholder: {
    color: '#666',
    fontSize: '12px',
    padding: '16px',
    textAlign: 'center',
  },
  // Folder
  folderItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '5px 8px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600,
    color: '#e8eaed',
    userSelect: 'none',
  },
  folderToggle: {
    width: '18px',
    fontSize: '18px',
    color: '#999',
    flexShrink: 0,
  },
  folderIcon: {
    fontSize: '14px',
    marginRight: '6px',
    flexShrink: 0,
  },
  folderTitle: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  folderCount: {
    fontSize: '11px',
    color: '#888',
    background: '#2a2a2a',
    borderRadius: '8px',
    padding: '0 6px',
    marginLeft: '6px',
    flexShrink: 0,
  },
  // Note
  noteItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '5px 8px',
    cursor: 'pointer',
    fontSize: '13px',
    color: '#e8eaed',
  },
  noteItemActive: {
    background: '#264f78',
  },
  multiSelected: {
    background: 'rgba(74, 158, 255, 0.15)',
    outline: '1px solid rgba(74, 158, 255, 0.3)',
    outlineOffset: '-1px',
    borderRadius: '4px',
  },
  noteIcon: {
    fontSize: '14px',
    marginRight: '6px',
    flexShrink: 0,
  },
  noteTitle: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  noteDate: {
    fontSize: '11px',
    color: '#666',
    flexShrink: 0,
    marginLeft: '8px',
  },
  renameInput: {
    flex: 1,
    background: '#2a2a2a',
    border: '1px solid #4a9eff',
    borderRadius: '3px',
    color: '#e8eaed',
    fontSize: '13px',
    padding: '2px 6px',
    outline: 'none',
  },
  // Context Menu
  contextMenu: {
    position: 'fixed',
    background: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: '6px',
    padding: '4px 0',
    minWidth: '140px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    zIndex: 1000,
  },
  contextMenuItem: {
    padding: '6px 12px',
    fontSize: '12px',
    color: '#e8eaed',
    cursor: 'pointer',
  },
  contextMenuSeparator: {
    height: '1px',
    background: '#444',
    margin: '4px 0',
  },
  // Drag & Drop
  dragging: {
    opacity: 0.35,
  },
  dropTarget: {
    background: 'rgba(74, 158, 255, 0.2)',
    outline: '2px solid #4a9eff',
    outlineOffset: '-2px',
    borderRadius: '4px',
  },
  dropTargetRoot: {
    background: 'rgba(74, 158, 255, 0.08)',
    outline: '2px dashed rgba(74, 158, 255, 0.3)',
    outlineOffset: '-4px',
  },
};
