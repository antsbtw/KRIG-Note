/**
 * useNoteSync — Note 数据列表订阅 hook（v1.4 NavSide 重构）。
 *
 * 维护 noteList / folderList 的本地副本：
 * - 启动时拉一次（dbReady 后）
 * - 订阅 onNoteListChanged 自动 refetch
 *
 * activeNoteId / expandedFolders 不在此 hook，业务通过 useActiveState 直接读。
 */
import { useState, useEffect, useCallback } from 'react';

export interface NoteListItem {
  id: string;
  title: string;
  folder_id: string | null;
  updated_at: number;
}

export interface FolderRecord {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  created_at: number;
}

declare const navSideAPI: {
  noteList: () => Promise<NoteListItem[]>;
  folderList: () => Promise<FolderRecord[]>;
  isDBReady: () => Promise<boolean>;
  onDBReady: (callback: () => void) => () => void;
  onNoteListChanged: (callback: (list: NoteListItem[]) => void) => () => void;
};

export interface NoteSyncState {
  noteList: NoteListItem[];
  folderList: FolderRecord[];
  refresh: () => void;
}

export function useNoteSync(): NoteSyncState {
  const [noteList, setNoteList] = useState<NoteListItem[]>([]);
  const [folderList, setFolderList] = useState<FolderRecord[]>([]);

  const refresh = useCallback(() => {
    void navSideAPI.noteList().then(setNoteList);
    void navSideAPI.folderList().then(setFolderList);
  }, []);

  useEffect(() => {
    void navSideAPI.isDBReady().then((ready) => {
      if (ready) refresh();
    });
    const unsubDB = navSideAPI.onDBReady(() => refresh());
    const unsubList = navSideAPI.onNoteListChanged(() => refresh());
    return () => {
      unsubDB();
      unsubList();
    };
  }, [refresh]);

  return { noteList, folderList, refresh };
}
