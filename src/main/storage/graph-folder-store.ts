import { getDB } from './client';

/**
 * GraphFolderStore — 图谱文件夹 CRUD（v1.4 NavSide 重构 M3）。
 *
 * 镜像 folder-store（笔记文件夹）的设计：
 * - 同级文件夹按 sort_order 排序
 * - 删除文件夹时递归删除子文件夹 + 把子图归到根（folder_id=null）
 *   注：与 note-store 不同——note 删 folder 时一并删 note，graph 选择保留图（更安全）
 *
 * 表名：graph_folder（与 graph 表分离，folder 不污染图本身）
 */

export interface GraphFolderRecord {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  created_at: number;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanRecordId(raw: unknown): string {
  return String(raw).replace(/^graph_folder:⟨?|⟩?$/g, '');
}

export const graphFolderStore = {
  async create(title: string, parentId?: string | null): Promise<GraphFolderRecord> {
    const db = getDB();
    if (!db) throw new Error('DB not ready');

    const id = generateId();
    const now = Date.now();

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

  /**
   * 删除文件夹：
   * - 递归删除子文件夹
   * - 子图谱 folder_id 置 null（图保留，归到根）
   */
  async delete(id: string): Promise<void> {
    const db = getDB();
    if (!db) return;

    // 递归删除子文件夹
    const children = await db.query<[{ id: unknown }[]]>(
      `SELECT id FROM graph_folder WHERE parent_id = $id`,
      { id },
    );
    const childFolders = children[0] || [];
    for (const child of childFolders) {
      const childId = cleanRecordId(child.id);
      await this.delete(childId);
    }

    // 子图谱归到根（不删图，避免数据丢失）
    await db.query(
      `UPDATE graph SET folder_id = NULL WHERE folder_id = $id`,
      { id },
    );

    // 删除文件夹本身
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
      `SELECT id, title, parent_id, sort_order, created_at FROM graph_folder ORDER BY sort_order ASC`,
    );
    const records = result[0] || [];
    return records.map((r) => ({
      id: cleanRecordId(r.id),
      title: r.title || '未命名文件夹',
      parent_id: r.parent_id ?? null,
      sort_order: r.sort_order ?? 0,
      created_at: r.created_at || 0,
    }));
  },
};
