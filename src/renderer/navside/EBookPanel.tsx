import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * EBookPanel — eBook 书架面板（树形列表 + 拖拽 + 右键菜单）
 *
 * 复用 Note 的文件夹交互模式：创建、嵌套、拖拽、展开/收起、重命名、删除。
 */

// ── 数据类型 ──

interface EBookEntry {
  id: string;
  fileType: string;
  displayName: string;
  fileName: string;
  pageCount?: number;
  lastOpenedAt: number;
  storage: string;
  folderId: string | null;
}

interface EBookFolder {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
}

declare const navSideAPI: {
  ebookBookshelfList: () => Promise<EBookEntry[]>;
  ebookPickFile: () => Promise<{ filePath: string; fileName: string; fileType: string } | null>;
  ebookBookshelfAdd: (filePath: string, fileType: string, storage: 'managed' | 'link') => Promise<unknown>;
  ebookBookshelfOpen: (id: string) => Promise<{ success: boolean; error?: string }>;
  ebookBookshelfRemove: (id: string) => Promise<void>;
  ebookBookshelfRename: (id: string, displayName: string) => Promise<void>;
  ebookBookshelfMove: (id: string, folderId: string | null) => Promise<void>;
  ebookFolderList: () => Promise<EBookFolder[]>;
  ebookFolderCreate: (title: string, parentId?: string | null) => Promise<EBookFolder>;
  ebookFolderRename: (id: string, title: string) => Promise<void>;
  ebookFolderDelete: (id: string) => Promise<void>;
  ebookFolderMove: (id: string, parentId: string | null) => Promise<void>;
  ebookSetExpandedFolders: (folderIds: string[]) => Promise<void>;
  onEbookBookshelfChanged: (callback: (list: EBookEntry[]) => void) => () => void;
};

// ── 工具函数 ──

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? '昨天' : `${days}天前`;
  return new Date(ts).toLocaleDateString();
}

const FILE_ICONS: Record<string, string> = { pdf: '📄', epub: '📖', djvu: '📄', cbz: '🖼️' };

// ── 组件 ──

interface Props {
  activeBookId: string | null;
  initialExpandedFolders?: string[];
  onActiveBookChange: (id: string | null) => void;
}

export function EBookPanel({ activeBookId, initialExpandedFolders, onActiveBookChange }: Props) {
  const [bookList, setBookList] = useState<EBookEntry[]>([]);
  const [folderList, setFolderList] = useState<EBookFolder[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(initialExpandedFolders ?? []),
  );

  // 右键菜单
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number;
    type: 'book' | 'folder';
    id: string;
    folderId?: string | null;
  } | null>(null);

  // 重命名
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingType, setRenamingType] = useState<'book' | 'folder'>('book');
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // 拖拽
  const [dragItem, setDragItem] = useState<{ type: 'book' | 'folder'; id: string } | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  // 导入弹窗
  const [importModal, setImportModal] = useState<{
    filePath: string;
    fileName: string;
    fileType: string;
  } | null>(null);
  const [importStorage, setImportStorage] = useState<'managed' | 'link'>('managed');

  // Toast 错误提示
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // 持久化文件夹展开状态
  useEffect(() => {
    navSideAPI.ebookSetExpandedFolders(Array.from(expandedFolders));
  }, [expandedFolders]);

  // 首次加载时，自动展开 activeBookId 所在的文件夹链
  useEffect(() => {
    if (!activeBookId || bookList.length === 0) return;
    const book = bookList.find((b) => b.id === activeBookId);
    if (!book?.folderId) return;

    // 向上遍历文件夹链，全部展开
    const toExpand = new Set(expandedFolders);
    let currentId: string | null = book.folderId;
    while (currentId) {
      toExpand.add(currentId);
      const parent = folderList.find((f) => f.id === currentId);
      currentId = parent?.parent_id ?? null;
    }
    if (toExpand.size !== expandedFolders.size) {
      setExpandedFolders(toExpand);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBookId, bookList.length]);

  // ── 数据加载 ──

  const fetchAll = useCallback(() => {
    navSideAPI.ebookBookshelfList().then(setBookList);
    navSideAPI.ebookFolderList().then(setFolderList);
  }, []);

  useEffect(() => {
    fetchAll();
    const unsub = navSideAPI.onEbookBookshelfChanged(() => fetchAll());
    return unsub;
  }, [fetchAll]);

  // 右键菜单关闭
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  // 重命名聚焦
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  // ── 操作 ──

  const handleOpenBook = useCallback(async (id: string) => {
    const result = await navSideAPI.ebookBookshelfOpen(id);
    if (result.success) {
      onActiveBookChange(id);
      return;
    }
    const book = bookList.find((b) => b.id === id);
    const name = book?.displayName ?? '该书';
    const reason = result.error === 'File not found'
      ? '源文件已丢失（可能被移动、删除，或备份/还原后路径失效）'
      : result.error === 'Entry not found'
        ? '书架记录不存在'
        : (result.error || '未知错误');
    setToast(`无法打开「${name}」：${reason}`);
  }, [onActiveBookChange, bookList]);

  const handleClickFolder = useCallback((folderId: string) => {
    setExpandedFolders((s) => {
      const next = new Set(s);
      if (next.has(folderId)) next.delete(folderId); else next.add(folderId);
      return next;
    });
  }, []);

  const startRename = useCallback((type: 'book' | 'folder', id: string) => {
    setContextMenu(null);
    const item = type === 'book'
      ? bookList.find((b) => b.id === id)
      : folderList.find((f) => f.id === id);
    setRenamingId(id);
    setRenamingType(type);
    setRenameValue(type === 'book' ? (item as any)?.displayName || '' : (item as any)?.title || '');
  }, [bookList, folderList]);

  const commitRename = useCallback(() => {
    if (renamingId && renameValue.trim()) {
      if (renamingType === 'book') {
        navSideAPI.ebookBookshelfRename(renamingId, renameValue.trim());
      } else {
        navSideAPI.ebookFolderRename(renamingId, renameValue.trim());
      }
    }
    setRenamingId(null);
  }, [renamingId, renamingType, renameValue]);

  const handleCreateFolder = useCallback((parentId?: string | null) => {
    navSideAPI.ebookFolderCreate('新建文件夹', parentId).then((folder) => {
      if (folder?.id) {
        if (parentId) setExpandedFolders((s) => new Set(s).add(parentId));
        setRenamingId(folder.id);
        setRenamingType('folder');
        setRenameValue('新建文件夹');
      }
    });
  }, []);

  // 导入流程：先选文件 → 弹窗选模式 → 导入
  const handleImport = useCallback(async () => {
    const picked = await navSideAPI.ebookPickFile();
    if (!picked) return;
    setImportModal(picked);
    setImportStorage('managed'); // 默认托管模式
  }, []);

  const handleImportConfirm = useCallback(async () => {
    if (!importModal) return;
    await navSideAPI.ebookBookshelfAdd(importModal.filePath, importModal.fileType, importStorage);
    setImportModal(null);
  }, [importModal, importStorage]);

  // ActionBar 事件
  useEffect(() => {
    const folderHandler = () => handleCreateFolder();
    const importHandler = () => handleImport();
    window.addEventListener('ebook:create-folder', folderHandler);
    window.addEventListener('ebook:import', importHandler);
    return () => {
      window.removeEventListener('ebook:create-folder', folderHandler);
      window.removeEventListener('ebook:import', importHandler);
    };
  }, [handleCreateFolder, handleImport]);

  // ── 拖拽 ──

  const isDescendant = useCallback((folderId: string, targetId: string): boolean => {
    let current = targetId;
    while (current) {
      if (current === folderId) return true;
      const parent = folderList.find((f) => f.id === current);
      current = parent?.parent_id ?? '';
    }
    return false;
  }, [folderList]);

  const handleDragStart = useCallback((e: React.DragEvent, type: 'book' | 'folder', id: string) => {
    setDragItem({ type, id });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `${type}:${id}`);
    // 创建紧凑的自定义拖拽预览
    const el = e.currentTarget as HTMLElement;
    const ghost = document.createElement('div');
    ghost.style.cssText = 'position:fixed;top:-1000px;left:-1000px;padding:4px 12px;background:#264f78;color:#e8eaed;font-size:12px;border-radius:4px;white-space:nowrap;max-width:200px;overflow:hidden;text-overflow:ellipsis;';
    const name = type === 'book'
      ? bookList.find((b) => b.id === id)?.displayName
      : folderList.find((f) => f.id === id)?.title;
    ghost.textContent = name || '';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 10, 10);
    requestAnimationFrame(() => document.body.removeChild(ghost));
  }, [bookList, folderList]);

  const handleDragEnd = useCallback(() => {
    setDragItem(null);
    setDropTargetId(null);
  }, [dropTargetId]);

  const handleDragOver = useCallback((e: React.DragEvent, targetId: string) => {
    if (!dragItem) return;
    if (dragItem.type === 'folder' && dragItem.id === targetId) return;
    if (dragItem.type === 'folder' && targetId !== 'root' && isDescendant(dragItem.id, targetId)) return;
    e.preventDefault();
    e.stopPropagation(); // 阻止冒泡到根容器
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
    e.stopPropagation(); // 阻止冒泡到根目录容器
    if (!dragItem) return;

    if (dragItem.type === 'book') {
      const book = bookList.find((b) => b.id === dragItem.id);
      if (book && book.folderId !== targetFolderId) {
        navSideAPI.ebookBookshelfMove(dragItem.id, targetFolderId);
        if (targetFolderId) setExpandedFolders((s) => new Set(s).add(targetFolderId));
      }
    } else {
      const folder = folderList.find((f) => f.id === dragItem.id);
      if (folder && folder.parent_id !== targetFolderId) {
        if (!targetFolderId || !isDescendant(dragItem.id, targetFolderId)) {
          navSideAPI.ebookFolderMove(dragItem.id, targetFolderId);
          if (targetFolderId) setExpandedFolders((s) => new Set(s).add(targetFolderId));
        }
      }
    }

    setDragItem(null);
    setDropTargetId(null);
  }, [dragItem, bookList, folderList, isDescendant]);

  // ── 右键菜单 ──

  const handleContextMenu = useCallback((e: React.MouseEvent, type: 'book' | 'folder', id: string, folderId?: string | null) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, type, id, folderId });
  }, []);

  const renderContextMenu = () => {
    if (!contextMenu) return null;
    const { type, id, folderId } = contextMenu;
    return (
      <div style={{ ...styles.contextMenu, left: contextMenu.x, top: contextMenu.y }}>
        {type === 'folder' && (
          <button style={styles.contextItem} onClick={() => { handleCreateFolder(id); setContextMenu(null); }}>
            新建子文件夹
          </button>
        )}
        <button style={styles.contextItem} onClick={() => {
          if (type === 'book') {
            const entry = bookList.find((e) => e.id === id);
            setRenameValue(entry?.displayName ?? '');
          } else {
            const folder = folderList.find((f) => f.id === id);
            setRenameValue(folder?.title ?? '');
          }
          setRenamingId(id);
          setRenamingType(type);
          setContextMenu(null);
        }}>
          重命名
        </button>
        {type === 'book' && folderId && (
          <button style={styles.contextItem} onClick={() => {
            navSideAPI.ebookBookshelfMove(id, null);
            setContextMenu(null);
          }}>
            移出文件夹
          </button>
        )}
        <button style={{ ...styles.contextItem, color: '#f87171' }} onClick={() => {
          if (type === 'book') {
            navSideAPI.ebookBookshelfRemove(id);
            if (activeBookId === id) onActiveBookChange(null);
          } else {
            navSideAPI.ebookFolderDelete(id);
          }
          setContextMenu(null);
        }}>
          删除
        </button>
      </div>
    );
  };

  // ── 导入弹窗 ──

  const renderImportModal = () => {
    if (!importModal) return null;
    return (
      <div style={styles.modalOverlay} onClick={() => setImportModal(null)}>
        <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div style={styles.modalTitle}>导入电子书</div>
          <div style={styles.modalFileName}>
            📄 {importModal.fileName}
          </div>

          <label style={styles.radioLabel}>
            <input
              type="radio"
              name="storage"
              checked={importStorage === 'managed'}
              onChange={() => setImportStorage('managed')}
            />
            <div>
              <div style={styles.radioTitle}>拷贝到 KRIG 管理（推荐）</div>
              <div style={styles.radioDesc}>文件将被复制到 KRIG 的资料库中，不会因为原文件移动或删除而丢失。</div>
            </div>
          </label>

          <label style={styles.radioLabel}>
            <input
              type="radio"
              name="storage"
              checked={importStorage === 'link'}
              onChange={() => setImportStorage('link')}
            />
            <div>
              <div style={styles.radioTitle}>链接原文件</div>
              <div style={styles.radioDesc}>仅记录文件路径，不复制文件。移动或删除原文件后将无法打开。</div>
            </div>
          </label>

          <div style={styles.modalActions}>
            <button style={styles.modalBtnCancel} onClick={() => setImportModal(null)}>取消</button>
            <button style={styles.modalBtnConfirm} onClick={handleImportConfirm}>导入</button>
          </div>
        </div>
      </div>
    );
  };

  // ── 树形渲染 ──

  const buildTree = (parentId: string | null, depth: number): React.ReactNode[] => {
    const nodes: React.ReactNode[] = [];

    // 文件夹
    const folders = folderList
      .filter((f) => f.parent_id === parentId)
      .sort((a, b) => a.sort_order - b.sort_order);

    for (const folder of folders) {
      const isExpanded = expandedFolders.has(folder.id);
      const childCount = bookList.filter((b) => b.folderId === folder.id).length
        + folderList.filter((f) => f.parent_id === folder.id).length;
      const isDragging = dragItem?.type === 'folder' && dragItem.id === folder.id;
      const isDropTarget = dropTargetId === folder.id;

      nodes.push(
        <div key={`f-${folder.id}`}>
          <div
            draggable
            onDragStart={(e) => handleDragStart(e, 'folder', folder.id)}
            onDragEnd={handleDragEnd}
            style={{
              ...styles.folderItem,
              paddingLeft: `${12 + depth * 16}px`,
              ...(isDropTarget ? styles.dropTarget : {}),
              ...(isDragging ? styles.dragging : {}),
            }}
            onClick={() => handleClickFolder(folder.id)}
            onDoubleClick={() => startRename('folder', folder.id)}
            onContextMenu={(e) => handleContextMenu(e, 'folder', folder.id)}
            onDragOver={(e) => handleDragOver(e, folder.id)}
            onDragLeave={(e) => handleDragLeave(e, folder.id)}
            onDrop={(e) => handleDrop(e, folder.id)}
          >
            <span style={styles.folderToggle}>{isExpanded ? '▾' : '▸'}</span>
            <span style={styles.folderIcon}>{(isExpanded || dropTargetId === folder.id) ? '📂' : '📁'}</span>
            {renamingId === folder.id ? (
              <input
                ref={renameInputRef}
                style={styles.renameInput}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <span style={styles.folderTitle}>{folder.title}</span>
                {childCount > 0 && (
                  <span style={styles.folderCount}>{childCount}</span>
                )}
              </>
            )}
          </div>
          {isExpanded && buildTree(folder.id, depth + 1)}
        </div>,
      );
    }

    // 书本
    const books = bookList
      .filter((b) => b.folderId === parentId)
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);

    for (const book of books) {
      const isDragging = dragItem?.type === 'book' && dragItem.id === book.id;
      const isActive = book.id === activeBookId;

      nodes.push(
        <div
          key={`b-${book.id}`}
          draggable
          onDragStart={(e) => handleDragStart(e, 'book', book.id)}
          onDragEnd={handleDragEnd}
          style={{
            ...styles.bookItem,
            paddingLeft: `${12 + depth * 16 + (parentId ? 16 : 0)}px`,
            ...(isActive ? styles.bookItemActive : {}),
            ...(isDragging ? styles.dragging : {}),
          }}
          onClick={() => handleOpenBook(book.id)}
          onDoubleClick={() => startRename('book', book.id)}
          onContextMenu={(e) => handleContextMenu(e, 'book', book.id, book.folderId)}
          onMouseEnter={(e) => {
            if (!isActive) (e.currentTarget as HTMLElement).style.background = '#2a2a2a';
          }}
          onMouseLeave={(e) => {
            if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent';
          }}
        >
          <span style={styles.bookIcon}>{FILE_ICONS[book.fileType] || '📄'}</span>
          {renamingId === book.id ? (
            <input
              ref={renameInputRef}
              style={styles.renameInput}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              <span style={styles.bookTitle}>{book.displayName}</span>
              <span style={styles.bookMeta}>
                {book.pageCount ? `${book.pageCount}页 · ` : ''}{relativeTime(book.lastOpenedAt)}
              </span>
            </>
          )}
        </div>,
      );
    }

    return nodes;
  };

  // ── 渲染 ──

  if (bookList.length === 0 && folderList.length === 0) {
    return (
      <div style={styles.empty}>
        <span style={styles.emptyText}>点击上方 + 导入 添加电子书</span>
        {renderImportModal()}
      </div>
    );
  }

  return (
    <div
      style={{
        ...styles.list,
        ...(dropTargetId === 'root' ? styles.dropTargetRoot : {}),
      }}
      onDragOver={(e) => handleDragOver(e, 'root')}
      onDragLeave={(e) => handleDragLeave(e, 'root')}
      onDrop={(e) => handleDrop(e, null)}
    >
      {buildTree(null, 0)}
      {renderContextMenu()}
      {renderImportModal()}
      {toast && (
        <div style={styles.toast} onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  );
}

// ── 样式 ──

const styles: Record<string, React.CSSProperties> = {
  list: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: '4px 0',
    position: 'relative',
  },
  toast: {
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
  },
  // ── Folder ──
  folderItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '5px 8px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600,
    color: '#e8eaed',
    userSelect: 'none' as const,
    overflow: 'hidden',
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
    whiteSpace: 'nowrap' as const,
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
  // ── Book ──
  bookItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '5px 8px',
    cursor: 'pointer',
    fontSize: '13px',
    color: '#e8eaed',
    overflow: 'hidden',
  },
  bookItemActive: {
    background: '#264f78',
  },
  bookIcon: {
    fontSize: '14px',
    marginRight: '6px',
    flexShrink: 0,
  },
  bookTitle: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  bookMeta: {
    fontSize: '11px',
    color: '#666',
    flexShrink: 0,
    marginLeft: '8px',
  },
  // ── Shared ──
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
  // ── Drag & Drop ──
  dragging: {
    opacity: 0.35,
  },
  dropTarget: {
    background: '#264f78',
    boxShadow: 'inset 3px 0 0 #4a9eff',
    borderRadius: '4px',
  },
  dropTargetRoot: {
    // 根目录拖放不需要高亮整个区域
    outlineOffset: '-4px',
  },
  // ── Empty ──
  empty: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  emptyText: {
    color: '#666',
    fontSize: 13,
  },
  // ── Context Menu ──
  contextMenu: {
    position: 'fixed' as const,
    background: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: '6px',
    padding: '4px 0',
    minWidth: '140px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    zIndex: 1000,
  },
  contextItem: {
    padding: '6px 12px',
    fontSize: '12px',
    color: '#e8eaed',
    cursor: 'pointer',
    display: 'block',
    width: '100%',
    background: 'transparent',
    border: 'none',
    textAlign: 'left' as const,
  },
  // 导入弹窗
  modalOverlay: {
    position: 'fixed' as const,
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
  },
  modal: {
    background: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: 10,
    padding: '20px 24px',
    width: 360,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: '#e8eaed',
    marginBottom: 12,
  },
  modalFileName: {
    fontSize: 13,
    color: '#ccc',
    padding: '8px 10px',
    background: '#333',
    borderRadius: 6,
    marginBottom: 16,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  radioLabel: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '8px 0',
    cursor: 'pointer',
  },
  radioTitle: {
    fontSize: 13,
    color: '#e8eaed',
    fontWeight: 500,
  },
  radioDesc: {
    fontSize: 11,
    color: '#888',
    marginTop: 2,
    lineHeight: '1.4',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 18,
  },
  modalBtnCancel: {
    background: 'transparent',
    border: '1px solid #555',
    borderRadius: 6,
    color: '#ccc',
    fontSize: 13,
    padding: '6px 16px',
    cursor: 'pointer',
  },
  modalBtnConfirm: {
    background: '#3b82f6',
    border: 'none',
    borderRadius: 6,
    color: '#fff',
    fontSize: 13,
    padding: '6px 16px',
    cursor: 'pointer',
  },
};
