/**
 * useWorkspaceSync —— 框架层 hook。
 *
 * v1.4 重构：原版同时管 workspace + note + ebook + graph 业务状态，
 * 现仅保留**框架级状态**：
 *   - modes / activeWorkModeId / registration / dbReady
 *
 * 插件级 active state（activeNoteId / activeBookId / 等）已迁到
 * `src/renderer/navside/store/active-state-store.ts`，插件通过
 * `useActiveState(selector)` 消费。
 *
 * 数据列表（noteList / folderList 等）由各插件自己管（如 useNoteSync）。
 */
import { useState, useEffect } from 'react';
import type { WorkModeRegistration, NavSideRegistration } from '../../../shared/types';

declare const navSideAPI: {
  listWorkModes: () => Promise<WorkModeRegistration[]>;
  isDBReady: () => Promise<boolean>;
  onDBReady: (callback: () => void) => () => void;
  onStateChanged: (callback: (state: unknown) => void) => () => void;
  getActiveState: () => Promise<{ workspaces: unknown[]; activeId: string | null; active?: { workModeId: string } }>;
  getNavSideRegistration: (workModeId: string) => Promise<NavSideRegistration | null>;
};

export interface WorkspaceSyncState {
  modes: WorkModeRegistration[];
  activeWorkModeId: string;
  registration: NavSideRegistration | null;
  dbReady: boolean;
}

export function useWorkspaceSync(): WorkspaceSyncState {
  const [modes, setModes] = useState<WorkModeRegistration[]>([]);
  const [activeWorkModeId, setActiveWorkModeId] = useState<string>('');
  const [registration, setRegistration] = useState<NavSideRegistration | null>(null);
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    void navSideAPI.listWorkModes().then((all) => setModes(all.filter((m) => !m.hidden)));

    void navSideAPI.getActiveState().then((data) => {
      if (data.active) setActiveWorkModeId(data.active.workModeId);
    });

    const unsubState = navSideAPI.onStateChanged((data: unknown) => {
      const d = data as { active?: { workModeId: string } };
      if (d.active) setActiveWorkModeId(d.active.workModeId);
    });

    const unsubDB = navSideAPI.onDBReady(() => setDbReady(true));
    void navSideAPI.isDBReady().then((ready) => {
      if (ready) setDbReady(true);
    });

    return () => {
      unsubState();
      unsubDB();
    };
  }, []);

  // 当前 WorkMode 的 NavSide 注册信息
  useEffect(() => {
    if (!activeWorkModeId) return;
    void navSideAPI.getNavSideRegistration(activeWorkModeId).then((reg) => {
      setRegistration(reg);
    });
  }, [activeWorkModeId]);

  return { modes, activeWorkModeId, registration, dbReady };
}
