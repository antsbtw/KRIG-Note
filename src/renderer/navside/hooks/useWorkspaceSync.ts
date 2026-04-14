import { useState, useEffect, useCallback } from 'react';
import type { WorkModeRegistration, NavSideRegistration } from '../../../shared/types';

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

declare const navSideAPI: {
  listWorkModes: () => Promise<WorkModeRegistration[]>;
  noteList: () => Promise<NoteListItem[]>;
  folderList: () => Promise<FolderRecord[]>;
  isDBReady: () => Promise<boolean>;
  onDBReady: (callback: () => void) => () => void;
  getActiveState: () => Promise<{ workspaces: unknown[]; activeId: string | null; active?: { workModeId: string; activeNoteId?: string | null; expandedFolders?: string[]; activeBookId?: string | null; ebookExpandedFolders?: string[] } }>;
  setExpandedFolders: (folderIds: string[]) => Promise<void>;
  onRestoreWorkspaceState: (callback: (state: { activeNoteId: string | null; expandedFolders: string[]; activeBookId?: string | null; ebookExpandedFolders?: string[] }) => void) => () => void;
  onStateChanged: (callback: (state: unknown) => void) => () => void;
  onNoteListChanged: (callback: (list: NoteListItem[]) => void) => () => void;
  getNavSideRegistration: (workModeId: string) => Promise<NavSideRegistration | null>;
};

export interface WorkspaceSyncState {
  modes: WorkModeRegistration[];
  activeWorkModeId: string;
  registration: NavSideRegistration | null;
  activeBookId: string | null;
  ebookExpandedFolders: string[];
  noteList: NoteListItem[];
  folderList: FolderRecord[];
  dbReady: boolean;
  activeNoteId: string | null;
  expandedFolders: Set<string>;
  setActiveNoteId: (id: string | null) => void;
  setExpandedFolders: React.Dispatch<React.SetStateAction<Set<string>>>;
  setActiveBookId: (id: string | null) => void;
  setEbookExpandedFolders: (folders: string[]) => void;
}

export function useWorkspaceSync(): WorkspaceSyncState {
  const [modes, setModes] = useState<WorkModeRegistration[]>([]);
  const [activeWorkModeId, setActiveWorkModeId] = useState<string>('');
  const [registration, setRegistration] = useState<NavSideRegistration | null>(null);
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [ebookExpandedFolders, setEbookExpandedFolders] = useState<string[]>([]);
  const [noteList, setNoteList] = useState<NoteListItem[]>([]);
  const [folderList, setFolderList] = useState<FolderRecord[]>([]);
  const [dbReady, setDbReady] = useState(false);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const fetchAll = useCallback(() => {
    navSideAPI.noteList().then(setNoteList);
    navSideAPI.folderList().then(setFolderList);
  }, []);

  // 初始化 + 事件监听
  useEffect(() => {
    navSideAPI.listWorkModes().then(all => setModes(all.filter(m => !m.hidden)));

    navSideAPI.getActiveState().then((data) => {
      if (data.active) {
        const ws = data.active as any;
        setActiveWorkModeId(ws.workModeId);
        if (ws.activeNoteId) setActiveNoteId(ws.activeNoteId);
        if (ws.expandedFolders) setExpandedFolders(new Set(ws.expandedFolders));
        if (ws.activeBookId) setActiveBookId(ws.activeBookId);
        if (ws.ebookExpandedFolders) setEbookExpandedFolders(ws.ebookExpandedFolders);
      }
    });

    const unsubState = navSideAPI.onStateChanged((data: unknown) => {
      const d = data as { active?: { workModeId: string; activeNoteId?: string | null; activeBookId?: string | null; ebookExpandedFolders?: string[] } };
      if (d.active) {
        setActiveWorkModeId(d.active.workModeId);
        if (d.active.activeNoteId !== undefined) setActiveNoteId(d.active.activeNoteId);
        if (d.active.activeBookId !== undefined) setActiveBookId(d.active.activeBookId);
        if (d.active.ebookExpandedFolders) setEbookExpandedFolders(d.active.ebookExpandedFolders);
      }
    });

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

    const unsubRestore = navSideAPI.onRestoreWorkspaceState((state) => {
      if (state.activeNoteId !== undefined) setActiveNoteId(state.activeNoteId);
      if (state.expandedFolders) setExpandedFolders(new Set(state.expandedFolders));
      if (state.activeBookId !== undefined) setActiveBookId(state.activeBookId);
      if (state.ebookExpandedFolders) setEbookExpandedFolders(state.ebookExpandedFolders);
    });

    return () => { unsubState(); unsubNoteList(); unsubDB(); unsubRestore(); };
  }, [fetchAll]);

  // 查询当前 WorkMode 的 NavSide 注册信息
  useEffect(() => {
    if (!activeWorkModeId) return;
    navSideAPI.getNavSideRegistration(activeWorkModeId).then((reg) => {
      setRegistration(reg);
    });
  }, [activeWorkModeId]);

  // 同步 expandedFolders 到 Workspace
  useEffect(() => {
    navSideAPI.setExpandedFolders(Array.from(expandedFolders));
  }, [expandedFolders]);

  return {
    modes, activeWorkModeId, registration,
    activeBookId, ebookExpandedFolders,
    noteList, folderList, dbReady,
    activeNoteId, expandedFolders,
    setActiveNoteId, setExpandedFolders,
    setActiveBookId, setEbookExpandedFolders,
  };
}
