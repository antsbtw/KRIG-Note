/**
 * Graph 画板类型定义(shared)
 *
 * 一个 GraphCanvasRecord 是一篇画板,doc_content 存的是 Canvas Document JSON
 * (详见 docs/graph/canvas/Canvas.md §4.1 + src/plugins/graph/canvas/persist/serialize.ts)。
 *
 * 与 Note 完全独立 — 自己的表 + 自己的 store + 自己的 IPC namespace,
 * 跟 ebook 形态对齐(每个 plugin 自有 store)。
 */

// 画板内容是结构化 JSON(序列化文档),不像 note 是 Atom[]。
// 在 store 层用 unknown 通用,具体形状由 plugins/graph/canvas/persist 决定。
export type CanvasDocumentJson = unknown;

export interface GraphCanvasRecord {
  id: string;
  title: string;
  /** 画板状态(Canvas Document JSON);v1 schema_version=1 */
  doc_content: CanvasDocumentJson;
  /** 画板类型 — v1 仅 'canvas',M2 加 'family-tree' / 'knowledge' / 等 */
  variant: GraphVariant;
  folder_id: string | null;
  created_at: number;
  updated_at: number;
}

export type GraphVariant = 'canvas' | 'family-tree' | 'knowledge' | 'mindmap';

export interface GraphCanvasListItem {
  id: string;
  title: string;
  variant: GraphVariant;
  folder_id: string | null;
  updated_at: number;
}

/** 画板文件夹(独立表 graph_folder,不与 note folder 共享) */
export interface GraphFolderRecord {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  created_at: number;
}

// ── Store 接口 ──

export interface IGraphStore {
  create(title: string, variant: GraphVariant, folderId?: string | null): Promise<GraphCanvasRecord>;
  get(id: string): Promise<GraphCanvasRecord | null>;
  save(id: string, docContent: CanvasDocumentJson, title: string): Promise<void>;
  delete(id: string): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  moveToFolder(id: string, folderId: string | null): Promise<void>;
  duplicate(id: string, targetFolderId?: string | null): Promise<GraphCanvasRecord | null>;
  list(): Promise<GraphCanvasListItem[]>;
}

export interface IGraphFolderStore {
  create(title: string, parentId?: string | null): Promise<GraphFolderRecord>;
  rename(id: string, title: string): Promise<void>;
  delete(id: string): Promise<void>;
  move(id: string, parentId: string | null): Promise<void>;
  list(): Promise<GraphFolderRecord[]>;
}
