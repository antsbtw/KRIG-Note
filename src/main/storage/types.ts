/**
 * 存储层类型定义
 */

export interface NoteRecord {
  id: string;
  title: string;
  doc_content: unknown[];
  created_at: number;
  updated_at: number;
}

export interface NoteListItem {
  id: string;
  title: string;
  updated_at: number;
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
  create(title?: string): Promise<NoteRecord>;
  get(id: string): Promise<NoteRecord | null>;
  save(id: string, docContent: unknown[], title: string): Promise<void>;
  delete(id: string): Promise<void>;
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
