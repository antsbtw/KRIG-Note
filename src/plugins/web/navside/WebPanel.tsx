import { useState, useEffect, useCallback } from 'react';

interface WebBookmark {
  id: string;
  title: string;
  url: string;
  favicon?: string;
  folderId: string | null;
  createdAt: number;
}

interface WebFolder {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  created_at: number;
}

interface WebHistoryEntry {
  id: string;
  url: string;
  title: string;
  visitedAt: number;
}

declare const navSideAPI: {
  webBookmarkList: () => Promise<WebBookmark[]>;
  webBookmarkRemove: (id: string) => Promise<void>;
  webFolderCreate: (title: string) => Promise<WebFolder>;
  webFolderList: () => Promise<WebFolder[]>;
  webFolderRename: (id: string, title: string) => Promise<void>;
  webFolderDelete: (id: string) => Promise<void>;
  webHistoryList: (limit?: number) => Promise<WebHistoryEntry[]>;
  noteOpenInEditor: (id: string) => Promise<void>;  // 复用 — 用于导航到 URL
};

/**
 * WebPanel — NavSide 中的 Web 书签 + 历史面板
 *
 * 注册制渲染：由 NavSide.tsx 根据 contentType === 'web-bookmarks' 分发。
 */
export function WebPanel() {
  const [bookmarks, setBookmarks] = useState<WebBookmark[]>([]);
  const [folders, setFolders] = useState<WebFolder[]>([]);
  const [history, setHistory] = useState<WebHistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  const loadData = useCallback(async () => {
    const [bks, fds, hist] = await Promise.all([
      navSideAPI.webBookmarkList(),
      navSideAPI.webFolderList(),
      navSideAPI.webHistoryList(20),
    ]);
    setBookmarks(bks);
    setFolders(fds);
    setHistory(hist);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleBookmarkClick = useCallback((url: string) => {
    // 通过 IPC 通知 WebView 导航到 URL
    // WebView 监听 VIEW_MESSAGE_RECEIVE 处理
    window.postMessage({ type: 'web:navigate', url }, '*');
  }, []);

  const handleDeleteBookmark = useCallback(async (id: string) => {
    await navSideAPI.webBookmarkRemove(id);
    loadData();
  }, [loadData]);

  // 按文件夹分组
  const rootBookmarks = bookmarks.filter((b) => !b.folderId);
  const folderBookmarks = (folderId: string) =>
    bookmarks.filter((b) => b.folderId === folderId);

  return (
    <div style={styles.panel}>
      {/* 书签列表 */}
      <div style={styles.list}>
        {folders.map((folder) => (
          <div key={folder.id}>
            <div style={styles.folderRow}>
              <span style={styles.folderIcon}>📁</span>
              <span style={styles.folderTitle}>{folder.title}</span>
            </div>
            {folderBookmarks(folder.id).map((bk) => (
              <div
                key={bk.id}
                style={{ ...styles.bookmarkRow, paddingLeft: 28 }}
                onClick={() => handleBookmarkClick(bk.url)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  handleDeleteBookmark(bk.id);
                }}
              >
                <span style={styles.bookmarkIcon}>🌐</span>
                <span style={styles.bookmarkTitle}>{bk.title}</span>
              </div>
            ))}
          </div>
        ))}

        {rootBookmarks.map((bk) => (
          <div
            key={bk.id}
            style={styles.bookmarkRow}
            onClick={() => handleBookmarkClick(bk.url)}
            onContextMenu={(e) => {
              e.preventDefault();
              handleDeleteBookmark(bk.id);
            }}
          >
            <span style={styles.bookmarkIcon}>🌐</span>
            <span style={styles.bookmarkTitle}>{bk.title}</span>
          </div>
        ))}

        {bookmarks.length === 0 && (
          <div style={styles.empty}>还没有书签</div>
        )}
      </div>

      {/* 最近访问 */}
      <div
        style={styles.historyHeader}
        onClick={() => setHistoryOpen((p) => !p)}
      >
        <span>{historyOpen ? '▾' : '▸'}</span>
        <span style={{ marginLeft: 4 }}>最近访问</span>
      </div>

      {historyOpen && (
        <div style={styles.list}>
          {history.map((entry) => (
            <div
              key={entry.id}
              style={styles.bookmarkRow}
              onClick={() => handleBookmarkClick(entry.url)}
            >
              <span style={styles.bookmarkIcon}>🕐</span>
              <span style={styles.bookmarkTitle}>{entry.title || entry.url}</span>
            </div>
          ))}
          {history.length === 0 && (
            <div style={styles.empty}>暂无浏览记录</div>
          )}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    flex: 1,
    overflow: 'auto',
    padding: '4px 0',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
  },
  folderRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 12px',
    fontSize: 12,
    color: '#ccc',
    cursor: 'default',
  },
  folderIcon: {
    fontSize: 12,
    marginRight: 6,
    flexShrink: 0,
  },
  folderTitle: {
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  bookmarkRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 12px',
    fontSize: 12,
    color: '#ccc',
    cursor: 'pointer',
    borderRadius: 3,
  },
  bookmarkIcon: {
    fontSize: 11,
    marginRight: 6,
    flexShrink: 0,
  },
  bookmarkTitle: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  historyHeader: {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 12px',
    fontSize: 12,
    color: '#888',
    cursor: 'pointer',
    borderTop: '1px solid #333',
    marginTop: 4,
    userSelect: 'none' as const,
  },
  empty: {
    padding: '16px 12px',
    textAlign: 'center' as const,
    color: '#555',
    fontSize: 12,
  },
};
