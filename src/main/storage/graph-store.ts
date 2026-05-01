import { getDB } from './client';
import type {
  GraphCanvasListItem, GraphCanvasRecord, GraphFolderRecord, GraphVariant,
  IGraphFolderStore, IGraphStore,
} from '../../shared/types/graph-types';

/**
 * GraphStore — 画板 CRUD
 *
 * SurrealDB record id 格式：graph_canvas:⟨xxx⟩
 * 对外暴露纯字符串 id(不含 table 前缀和角括号)。
 *
 * doc_content 是 Canvas Document JSON(详见 plugins/graph/canvas/persist/serialize.ts);
 * Note 的 doc_content 是 Atom[],画板是结构化 JSON,各自独立。
 *
 * 与 ebook bookshelf-store 形态对齐:每个 plugin 自有 store,自有 IPC namespace,
 * 不污染 noteStore。
 */

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanRecordId(raw: unknown, table: string): string {
  // SurrealDB 返回的 record id 是 "table:⟨xxx⟩" 形式;剥掉 table 前缀和角括号
  const prefix = new RegExp(`^${table}:⟨?|⟩?$`, 'g');
  return String(raw).replace(prefix, '');
}

function isValidVariant(raw: unknown): raw is GraphVariant {
  return raw === 'canvas' || raw === 'family-tree' || raw === 'knowledge' || raw === 'mindmap';
}

export const graphStore: IGraphStore = {
  async create(title: string, variant: GraphVariant, folderId?: string | null): Promise<GraphCanvasRecord> {
    const db = getDB();
    if (!db) throw new Error('DB not ready');

    const id = generateId();
    const now = Date.now();
    // 空画板:CanvasView 反序列化时 createEmptyDocument 会兜底,
    // 但这里也存一份合理初值,免得读到 null
    // schema_version=2 Freeform 风格:view.zoom 无量纲,与容器尺寸解耦
    const docContent = { schema_version: 2, view: { centerX: 0, centerY: 0, zoom: 1 }, instances: [] };

    const record: GraphCanvasRecord = {
      id,
      title: title || 'Untitled Canvas',
      doc_content: docContent,
      variant,
      folder_id: folderId ?? null,
      created_at: now,
      updated_at: now,
    };

    await db.query(
      `CREATE graph_canvas SET id = $id, title = $title, doc_content = $doc_content, variant = $variant, folder_id = $folder_id, created_at = $created_at, updated_at = $updated_at`,
      {
        id,
        title: record.title,
        doc_content: record.doc_content,
        variant,
        folder_id: record.folder_id,
        created_at: now,
        updated_at: now,
      },
    );

    return record;
  },

  async get(id: string): Promise<GraphCanvasRecord | null> {
    const db = getDB();
    if (!db) return null;

    const result = await db.query<[GraphCanvasRecord[]]>(
      `SELECT * FROM type::record('graph_canvas', $id) LIMIT 1`,
      { id },
    );

    const records = result[0];
    if (!records || records.length === 0) return null;

    const r = records[0];
    return {
      id: cleanRecordId(r.id, 'graph_canvas'),
      title: r.title || 'Untitled Canvas',
      doc_content: r.doc_content ?? null,
      variant: isValidVariant(r.variant) ? r.variant : 'canvas',
      folder_id: r.folder_id ?? null,
      created_at: r.created_at || 0,
      updated_at: r.updated_at || 0,
    };
  },

  async save(id: string, docContent: unknown, title: string): Promise<void> {
    const db = getDB();
    if (!db) return;

    const now = Date.now();
    await db.query(
      `UPDATE type::record('graph_canvas', $id) SET title = $title, doc_content = $doc_content, updated_at = $updated_at`,
      { id, title, doc_content: docContent, updated_at: now },
    );
  },

  async delete(id: string): Promise<void> {
    const db = getDB();
    if (!db) return;
    await db.query(`DELETE type::record('graph_canvas', $id)`, { id });
  },

  async rename(id: string, title: string): Promise<void> {
    const db = getDB();
    if (!db) return;

    const now = Date.now();
    await db.query(
      `UPDATE type::record('graph_canvas', $id) SET title = $title, updated_at = $updated_at`,
      { id, title, updated_at: now },
    );
  },

  async moveToFolder(id: string, folderId: string | null): Promise<void> {
    const db = getDB();
    if (!db) return;

    await db.query(
      `UPDATE type::record('graph_canvas', $id) SET folder_id = $folder_id`,
      { id, folder_id: folderId },
    );
  },

  async duplicate(id: string, targetFolderId?: string | null): Promise<GraphCanvasRecord | null> {
    const original = await this.get(id);
    if (!original) return null;

    const newId = generateId();
    const now = Date.now();
    const record: GraphCanvasRecord = {
      id: newId,
      title: `${original.title} (副本)`,
      doc_content: JSON.parse(JSON.stringify(original.doc_content)),
      variant: original.variant,
      folder_id: targetFolderId !== undefined ? targetFolderId : original.folder_id,
      created_at: now,
      updated_at: now,
    };

    const db = getDB();
    if (!db) return null;

    await db.query(
      `CREATE graph_canvas SET id = $id, title = $title, doc_content = $doc_content, variant = $variant, folder_id = $folder_id, created_at = $created_at, updated_at = $updated_at`,
      {
        id: newId,
        title: record.title,
        doc_content: record.doc_content,
        variant: record.variant,
        folder_id: record.folder_id,
        created_at: now,
        updated_at: now,
      },
    );
    return record;
  },

  async list(): Promise<GraphCanvasListItem[]> {
    const db = getDB();
    if (!db) return [];

    const result = await db.query<[Array<GraphCanvasListItem & { variant?: string }>]>(
      `SELECT id, title, variant, folder_id, updated_at FROM graph_canvas ORDER BY updated_at DESC`,
    );

    const records = result[0] || [];
    return records.map((r) => ({
      id: cleanRecordId(r.id, 'graph_canvas'),
      title: r.title || 'Untitled Canvas',
      variant: isValidVariant(r.variant) ? r.variant : 'canvas',
      folder_id: r.folder_id ?? null,
      updated_at: r.updated_at || 0,
    }));
  },
};

/**
 * GraphFolderStore — 画板文件夹 CRUD(独立分类树,不与 note folder 共享)
 *
 * 与 ebook 模式对齐:每个 plugin 自有 folder 表(graph_folder / ebook_folder /
 * note 用 folder),互不干扰。
 *
 * 删除文件夹 → 子画板的 folder_id 置 null(回到根级)。
 */
export const graphFolderStore: IGraphFolderStore = {
  async create(title: string, parentId?: string | null): Promise<GraphFolderRecord> {
    const db = getDB();
    if (!db) throw new Error('DB not ready');

    const id = generateId();
    const now = Date.now();

    // sort_order:同级文件夹数量 + 1
    const siblings = await db.query<[GraphFolderRecord[]]>(
      parentId
        ? `SELECT * FROM graph_folder WHERE parent_id = $parent_id`
        : `SELECT * FROM graph_folder WHERE parent_id = NONE OR parent_id = NULL`,
      { parent_id: parentId ?? null },
    );
    const sortOrder = (siblings[0]?.length ?? 0) + 1;

    const record: GraphFolderRecord = {
      id,
      title,
      parent_id: parentId ?? null,
      sort_order: sortOrder,
      created_at: now,
    };

    await db.query(
      `CREATE graph_folder SET id = $id, title = $title, parent_id = $parent_id, sort_order = $sort_order, created_at = $created_at`,
      { id, title, parent_id: record.parent_id, sort_order: sortOrder, created_at: now },
    );

    return record;
  },

  async rename(id: string, title: string): Promise<void> {
    const db = getDB();
    if (!db) return;

    await db.query(
      `UPDATE type::record('graph_folder', $id) SET title = $title`,
      { id, title },
    );
  },

  async delete(id: string): Promise<void> {
    const db = getDB();
    if (!db) return;

    // 1. 子画板的 folder_id 置 null(回到根级,与 folderStore 一致行为)
    await db.query(
      `UPDATE graph_canvas SET folder_id = NULL WHERE folder_id = $id`,
      { id },
    );
    // 2. 子文件夹递归删除
    const childResult = await db.query<[Array<{ id: unknown }>]>(
      `SELECT id FROM graph_folder WHERE parent_id = $id`,
      { id },
    );
    const children = childResult[0] || [];
    for (const child of children) {
      await graphFolderStore.delete(cleanRecordId(child.id, 'graph_folder'));
    }
    // 3. 删自己
    await db.query(`DELETE type::record('graph_folder', $id)`, { id });
  },

  async move(id: string, parentId: string | null): Promise<void> {
    const db = getDB();
    if (!db) return;

    await db.query(
      `UPDATE type::record('graph_folder', $id) SET parent_id = $parent_id`,
      { id, parent_id: parentId },
    );
  },

  async list(): Promise<GraphFolderRecord[]> {
    const db = getDB();
    if (!db) return [];

    const result = await db.query<[GraphFolderRecord[]]>(
      `SELECT * FROM graph_folder ORDER BY sort_order ASC`,
    );

    const records = result[0] || [];
    return records.map((r) => ({
      id: cleanRecordId(r.id, 'graph_folder'),
      title: r.title || '',
      parent_id: r.parent_id ?? null,
      sort_order: r.sort_order ?? 0,
      created_at: r.created_at || 0,
    }));
  },
};
