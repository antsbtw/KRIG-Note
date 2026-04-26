/**
 * useEBookSync — eBook 数据列表订阅 hook（v1.4 NavSide 重构 M4）。
 *
 * 维护 bookList / folderList 本地副本：
 * - 启动时拉一次（dbReady 后）
 * - 订阅 onEbookBookshelfChanged 自动 refetch
 *
 * activeBookId / ebookExpandedFolders 不在此 hook，业务通过 useActiveState 直接读。
 */
import { useState, useEffect, useCallback } from 'react';

export interface EBookEntry {
  id: string;
  fileType: string;
  displayName: string;
  fileName: string;
  pageCount?: number;
  lastOpenedAt: number;
  storage: string;
  folderId: string | null;
}

export interface EBookFolder {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
}

declare const navSideAPI: {
  ebookBookshelfList: () => Promise<EBookEntry[]>;
  ebookFolderList: () => Promise<EBookFolder[]>;
  isDBReady: () => Promise<boolean>;
  onDBReady: (cb: () => void) => () => void;
  onEbookBookshelfChanged: (cb: (list: EBookEntry[]) => void) => () => void;
};

export interface EBookSyncState {
  bookList: EBookEntry[];
  folderList: EBookFolder[];
  refresh: () => void;
}

export function useEBookSync(): EBookSyncState {
  const [bookList, setBookList] = useState<EBookEntry[]>([]);
  const [folderList, setFolderList] = useState<EBookFolder[]>([]);

  const refresh = useCallback(() => {
    void navSideAPI.ebookBookshelfList().then(setBookList).catch(() => {});
    void navSideAPI.ebookFolderList().then(setFolderList).catch(() => {});
  }, []);

  useEffect(() => {
    void navSideAPI.isDBReady().then((ready) => {
      if (ready) refresh();
    });
    const unsubDB = navSideAPI.onDBReady(() => refresh());
    const unsubList = navSideAPI.onEbookBookshelfChanged(() => refresh());
    return () => {
      unsubDB();
      unsubList();
    };
  }, [refresh]);

  return { bookList, folderList, refresh };
}
