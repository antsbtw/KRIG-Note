/**
 * 存储层类型定义
 */

/** Note 内的书签：指向顶层 block 的索引 */
export interface NoteBookmark {
  id: string;              // 稳定 ID
  block_index: number;     // 顶层 block 索引
  label: string;           // 显示名（默认取 block 文字前 30 字，用户可改）
  created_at: number;
}

export interface NoteRecord {
  id: string;
  title: string;
  doc_content: unknown[];
  folder_id: string | null;
  created_at: number;
  updated_at: number;
  /** 上次阅读/编辑的顶层 block 索引，重开时恢复滚动 */
  last_view_block_index?: number;
  /** 用户书签列表（类 PDF 阅读书签） */
  bookmarks?: NoteBookmark[];
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
  /** 保存上次阅读顶层 block 索引，不扰动 updated_at */
  saveLastViewBlockIndex(id: string, index: number): Promise<void>;
  /** 保存书签列表（全量替换） */
  saveBookmarks(id: string, bookmarks: NoteBookmark[]): Promise<void>;
}

export interface IActivityStore {
  log(action: string, target?: string, metadata?: Record<string, unknown>): Promise<void>;
  getRecent(limit?: number): Promise<ActivityRecord[]>;
}

export interface ISessionStore {
  save(session: SessionData): Promise<void>;
  load(): Promise<SessionData | null>;
}

// ── Graph ──

export type GraphVariant = 'knowledge' | 'bpmn' | 'mindmap' | 'timeline' | 'canvas' | 'basic';

export interface GraphRecord {
  id: string;
  title: string;
  variant: GraphVariant;
  host_note_id: string | null;
  /** v1.4 NavSide 重构：folder_id 用于 graph_folder 树组织。null = 根目录。
   *  schemaless：旧数据自动 null（无字段视为 null） */
  folder_id?: string | null;
  created_at: number;
  updated_at: number;
  meta?: Record<string, unknown>;
}

export interface GraphListItem {
  id: string;
  title: string;
  variant: GraphVariant;
  host_note_id: string | null;
  folder_id?: string | null;
  updated_at: number;
}

export interface IGraphStore {
  create(title?: string, hostNoteId?: string | null, variant?: GraphVariant): Promise<GraphRecord>;
  get(id: string): Promise<GraphRecord | null>;
  list(): Promise<GraphListItem[]>;
  rename(id: string, title: string): Promise<void>;
  setVariant(id: string, variant: GraphVariant): Promise<void>;
  setHostNote(id: string, hostNoteId: string | null): Promise<void>;
  /** v1.4：将图移动到指定 folder（null = 根目录） */
  moveToFolder(id: string, folderId: string | null): Promise<void>;
  delete(id: string): Promise<void>;

  // ── 节点/边 CRUD ──
  loadGraphData(graphId: string): Promise<{ nodes: GraphNodeRecord[]; edges: GraphEdgeRecord[] }>;
  saveNode(node: GraphNodeRecord): Promise<void>;
  saveEdge(edge: GraphEdgeRecord): Promise<void>;
  deleteNode(graphId: string, nodeId: string): Promise<void>;
  deleteEdge(graphId: string, edgeId: string): Promise<void>;
}

// ── Graph 节点/边记录（持久化层）──

export interface GraphNodeRecord {
  id: string;
  graph_id: string;
  type: string;
  label: string;
  position_x: number;
  position_y: number;
  block_ids?: string[];
  meta?: Record<string, unknown>;
}

export interface GraphEdgeRecord {
  id: string;
  graph_id: string;
  type?: string;
  source: string;
  target: string;
  label?: string;
  meta?: Record<string, unknown>;
}
