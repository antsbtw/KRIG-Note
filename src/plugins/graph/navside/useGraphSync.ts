/**
 * useGraphSync — Graph 数据列表订阅 hook(对齐 useEBookSync)
 *
 * 维护 graphList + folderList 本地副本:
 * - 启动时拉一次(dbReady 后)
 * - 订阅 onGraphListChanged 自动 refetch
 *
 * activeGraphId / graphExpandedFolders 不在此 hook,业务通过 useActiveState 直接读。
 */
import { useState, useEffect, useCallback } from 'react';
import type { GraphCanvasListItem, GraphFolderRecord } from '../../../shared/types/graph-types';

declare const navSideAPI: {
  graphList: () => Promise<GraphCanvasListItem[]>;
  graphFolderList: () => Promise<GraphFolderRecord[]>;
  isDBReady: () => Promise<boolean>;
  onDBReady: (cb: () => void) => () => void;
  onGraphListChanged: (cb: (list: GraphCanvasListItem[]) => void) => () => void;
};

export interface GraphSyncState {
  graphList: GraphCanvasListItem[];
  folderList: GraphFolderRecord[];
  refresh: () => void;
}

export function useGraphSync(): GraphSyncState {
  const [graphList, setGraphList] = useState<GraphCanvasListItem[]>([]);
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
    const unsubList = navSideAPI.onGraphListChanged(() => refresh());
    return () => {
      unsubDB();
      unsubList();
    };
  }, [refresh]);

  return { graphList, folderList, refresh };
}
