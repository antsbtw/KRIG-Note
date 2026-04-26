/**
 * useGraphSync — Graph 数据列表订阅 hook（v1.4 NavSide 重构 M3）。
 *
 * 维护 graphList / graphFolderList 本地副本：
 * - 启动时拉一次（dbReady 后）
 * - 订阅 onGraphListChanged / onGraphFolderListChanged 自动 refetch
 *
 * activeGraphId / graphExpandedFolders 不在此 hook，业务通过 useActiveState 直接读。
 */
import { useState, useEffect, useCallback } from 'react';

export interface GraphListItem {
  id: string;
  title: string;
  variant: string;
  host_note_id: string | null;
  folder_id: string | null;
  updated_at: number;
}

export interface GraphFolderRecord {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  created_at: number;
}

declare const navSideAPI: {
  graphList: () => Promise<GraphListItem[]>;
  graphFolderList: () => Promise<GraphFolderRecord[]>;
  isDBReady: () => Promise<boolean>;
  onDBReady: (cb: () => void) => () => void;
  onGraphListChanged: (cb: (list: GraphListItem[]) => void) => () => void;
  onGraphFolderListChanged: (cb: (list: GraphFolderRecord[]) => void) => () => void;
};

export interface GraphSyncState {
  graphList: GraphListItem[];
  folderList: GraphFolderRecord[];
  refresh: () => void;
}

export function useGraphSync(): GraphSyncState {
  const [graphList, setGraphList] = useState<GraphListItem[]>([]);
  const [folderList, setFolderList] = useState<GraphFolderRecord[]>([]);

  const refresh = useCallback(() => {
    void navSideAPI.graphList().then(setGraphList).catch(() => {});
    void navSideAPI.graphFolderList().then(setFolderList).catch(() => {});
  }, []);

  useEffect(() => {
    void navSideAPI.isDBReady().then((ready) => {
      if (ready) refresh();
    });
    const unsubDB = navSideAPI.onDBReady(() => refresh());
    const unsubList = navSideAPI.onGraphListChanged((list) => setGraphList(list));
    const unsubFolder = navSideAPI.onGraphFolderListChanged((list) => setFolderList(list));
    return () => {
      unsubDB();
      unsubList();
      unsubFolder();
    };
  }, [refresh]);

  return { graphList, folderList, refresh };
}
