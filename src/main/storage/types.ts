/**
 * 存储层类型定义
 */

export interface NoteRecord {
  id: string;
  title: string;
  doc_content: unknown[];
  folder_id: string | null;
  created_at: number;
  updated_at: number;
}

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

export interface IFolderStore {
  create(title: string, parentId?: string | null): Promise<FolderRecord>;
  rename(id: string, title: string): Promise<void>;
  delete(id: string): Promise<void>;
  move(id: string, parentId: string | null): Promise<void>;
  list(): Promise<FolderRecord[]>;
}

export interface ActivityRecord {
  id: string;
  timestamp: number;
  action: string;
  target?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionData {
  workspaces: import('../../shared/types').WorkspaceState[];
  activeWorkspaceId: string | null;
  navSideWidth: number;
}

// ── IStorage 接口 ──

export interface INoteStore {
  create(title?: string, folderId?: string | null): Promise<NoteRecord>;
  get(id: string): Promise<NoteRecord | null>;
  save(id: string, docContent: unknown[], title: string): Promise<void>;
  delete(id: string): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  moveToFolder(id: string, folderId: string | null): Promise<void>;
  duplicate(id: string, targetFolderId?: string | null): Promise<NoteRecord | null>;
  list(): Promise<NoteListItem[]>;
}

export interface IActivityStore {
  log(action: string, target?: string, metadata?: Record<string, unknown>): Promise<void>;
  getRecent(limit?: number): Promise<ActivityRecord[]>;
}

export interface ISessionStore {
  save(session: SessionData): Promise<void>;
  load(): Promise<SessionData | null>;
}
