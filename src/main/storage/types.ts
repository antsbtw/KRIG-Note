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
  /** v1.4 graph-import 重构：图谱维度（schemaless 兼容老数据，缺省 = 2） */
  dimension?: 2 | 3;
  /** v1.4 graph-import 重构：当前激活布局算法 id（缺省 = 'force'） */
  active_layout?: string;
  /**
   * v1.6 B3 ViewMode 切换：当前激活的 ViewMode id（注册到 viewModeRegistry）。
   * v1.4/v1.5 数据 = undefined → 渲染时回退到 active_layout 对应的 ViewMode
   * （同 id 内置 ViewMode 默认存在：force / tree / grid）。
   */
  active_view_mode?: string;
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
  /** v1.4 graph-import：切换激活的布局算法 */
  setActiveLayout(id: string, layoutId: string): Promise<void>;
  /** v1.6 B3：切换激活的 ViewMode */
  setActiveViewMode(id: string, viewModeId: string): Promise<void>;
  delete(id: string): Promise<void>;
  // 节点/边 CRUD 由 graph-geometry-store / graph-intension-atom-store / graph-presentation-atom-store 接管
}

// ── v1.4 Graph 数据模型（feature/graph-import）──
//
// 四态分立：详见 docs/graph/KRIG-Graph-Import-Spec.md §1
//
// 数学态 (graph_geometry) — 几何骨架
// 物理态 (Substance Library) — 声明式资源，不入库
// 语义态 (graph_intension_atom) — 描述属性 atom
// 视觉态 (graph_presentation_atom) — 视觉属性 atom

/** 几何体类型（Point / Line / Surface / Volume） */
export type GeometryKind = 'point' | 'line' | 'surface' | 'volume';

/** 几何骨架记录（数学态） */
export interface GraphGeometryRecord {
  id: string;
  graph_id: string;
  kind: GeometryKind;
  /** 引用下层几何体的 id（point=[]，line/surface=point ids，volume=surface ids） */
  members: string[];
  created_at: number;
}

/** Intension Atom 的 value 类型 */
export type IntensionValueKind = 'text' | 'code' | 'ref' | 'number' | 'url';

/** Intension Atom 记录（语义态） */
export interface GraphIntensionAtomRecord {
  id: string;
  graph_id: string;
  /** 任意 graph_geometry.id */
  subject_id: string;
  /** 'label' / 'summary' / 'tags' / 'contains' / 'substance' / ... */
  predicate: string;
  value: string;
  value_kind: IntensionValueKind;
  /** 同 subject + predicate 多值时排序 */
  sort_order: number;
  created_at: number;
}

/** Presentation Atom 的 value 类型 */
export type PresentationValueKind = 'number' | 'color' | 'boolean' | 'enum' | 'text';

/** Presentation Atom 记录（视觉态） */
export interface GraphPresentationAtomRecord {
  id: string;
  graph_id: string;
  /** 'force' / 'tree' / '*' （'*' 表跨布局通用） */
  layout_id: string;
  /** 任意 graph_geometry.id */
  subject_id: string;
  /** 'position.x' / 'fill.color' / 'shape' / 'pinned' / ... */
  attribute: string;
  value: string;
  value_kind: PresentationValueKind;
  updated_at: number;
}

// ── 新 stores 的接口定义 ──

export interface IGraphGeometryStore {
  createBulk(records: Omit<GraphGeometryRecord, 'created_at'>[]): Promise<void>;
  list(graphId: string): Promise<GraphGeometryRecord[]>;
  create(record: Omit<GraphGeometryRecord, 'created_at'>): Promise<GraphGeometryRecord>;
  delete(id: string): Promise<void>;
  deleteByGraph(graphId: string): Promise<void>;
}

export interface IGraphIntensionAtomStore {
  createBulk(records: Omit<GraphIntensionAtomRecord, 'id' | 'created_at'>[]): Promise<void>;
  list(graphId: string, subjectId?: string): Promise<GraphIntensionAtomRecord[]>;
  create(record: Omit<GraphIntensionAtomRecord, 'id' | 'created_at'>): Promise<GraphIntensionAtomRecord>;
  update(id: string, fields: Partial<Omit<GraphIntensionAtomRecord, 'id' | 'graph_id' | 'created_at'>>): Promise<void>;
  delete(id: string): Promise<void>;
  deleteByGraph(graphId: string): Promise<void>;
}

export interface IGraphPresentationAtomStore {
  /** 列出。layoutIds 提供时，只返回 layout_id 匹配的（通常 ['*', activeLayout]） */
  list(graphId: string, layoutIds?: string[]): Promise<GraphPresentationAtomRecord[]>;
  /** upsert（按 graph_id + layout_id + subject_id + attribute 唯一性合并） */
  set(record: Omit<GraphPresentationAtomRecord, 'id' | 'updated_at'>): Promise<void>;
  setBulk(records: Omit<GraphPresentationAtomRecord, 'id' | 'updated_at'>[]): Promise<void>;
  delete(graphId: string, layoutId: string, subjectId: string, attribute: string): Promise<void>;
  /** 清空指定 layout 的所有 atom（"重置 layout"用） */
  clearByLayout(graphId: string, layoutId: string): Promise<void>;
  deleteByGraph(graphId: string): Promise<void>;
}
