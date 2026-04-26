/**
 * useWebSync — Web 书签数据列表订阅 hook（v1.4 NavSide 重构 M5）。
 *
 * 维护 bookmarkList / folderList 本地副本：
 * - 启动时拉一次（dbReady 后）
 * - 订阅 onWebBookmarkChanged 自动 refetch
 *
 * webExpandedFolders 不在此 hook，业务通过 useActiveState 直接读。
 */
import { useState, useEffect, useCallback } from 'react';

export interface WebBookmark {
  id: string;
  title: string;
  url: string;
  favicon?: string;
  folderId: string | null;
  createdAt: number;
}

export interface WebFolder {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  created_at: number;
}

declare const navSideAPI: {
  webBookmarkList: () => Promise<WebBookmark[]>;
  webFolderList: () => Promise<WebFolder[]>;
  isDBReady: () => Promise<boolean>;
  onDBReady: (cb: () => void) => () => void;
  onWebBookmarkChanged: (cb: () => void) => () => void;
};

export interface WebSyncState {
  bookmarkList: WebBookmark[];
  folderList: WebFolder[];
  refresh: () => void;
}

export function useWebSync(): WebSyncState {
  const [bookmarkList, setBookmarkList] = useState<WebBookmark[]>([]);
  const [folderList, setFolderList] = useState<WebFolder[]>([]);

  const refresh = useCallback(() => {
    void navSideAPI.webBookmarkList().then(setBookmarkList).catch(() => {});
    void navSideAPI.webFolderList().then(setFolderList).catch(() => {});
  }, []);

  useEffect(() => {
    void navSideAPI.isDBReady().then((ready) => {
      if (ready) refresh();
    });
    const unsubDB = navSideAPI.onDBReady(() => refresh());
    const unsubChange = navSideAPI.onWebBookmarkChanged(() => refresh());
    return () => {
      unsubDB();
      unsubChange();
    };
  }, [refresh]);

  return { bookmarkList, folderList, refresh };
}
