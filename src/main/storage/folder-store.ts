import { getDB } from './client';
import type { IFolderStore, FolderRecord } from './types';

/**
 * FolderStore — 文件夹 CRUD
 *
 * 文件夹是组织视图，不影响笔记存储位置。
 * 删除文件夹 → 子笔记的 folder_id 置 null（回到根级）。
 */

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanRecordId(raw: unknown): string {
  return String(raw).replace(/^folder:⟨?|⟩?$/g, '');
}

export const folderStore: IFolderStore = {
  async create(title: string, parentId?: string | null): Promise<FolderRecord> {
    const db = getDB();
    if (!db) throw new Error('DB not ready');

    const id = generateId();
    const now = Date.now();

    // sort_order：同级文件夹数量 + 1
    const siblings = await db.query<[FolderRecord[]]>(
      parentId
        ? `SELECT * FROM folder WHERE parent_id = $parent_id`
        : `SELECT * FROM folder WHERE parent_id = NONE OR parent_id = NULL`,
      { parent_id: parentId ?? null },
    );
    const sortOrder = (siblings[0]?.length ?? 0) + 1;

    const record: FolderRecord = {
      id,
      title,
      parent_id: parentId ?? null,
      sort_order: sortOrder,
      created_at: now,
    };

    await db.query(
      `CREATE folder SET id = $id, title = $title, parent_id = $parent_id, sort_order = $sort_order, created_at = $created_at`,
      { id, title, parent_id: record.parent_id, sort_order: sortOrder, created_at: now },
    );

    return record;
  },

  async rename(id: string, title: string): Promise<void> {
    const db = getDB();
    if (!db) return;

    await db.query(
      `UPDATE type::record('folder', $id) SET title = $title`,
      { id, title },
    );
  },

  async delete(id: string): Promise<void> {
    const db = getDB();
    if (!db) return;

    // 递归删除子文件夹
    const children = await db.query<[{ id: unknown }[]]>(
      `SELECT id FROM folder WHERE parent_id = $id`,
      { id },
    );
    const childFolders = children[0] || [];
    for (const child of childFolders) {
      const childId = cleanRecordId(child.id);
      await this.delete(childId);
    }

    // 删除该文件夹下的所有笔记
    await db.query(`DELETE FROM note WHERE folder_id = $id`, { id });

    // 删除文件夹本身
    await db.query(`DELETE type::record('folder', $id)`, { id });
  },

  async move(id: string, parentId: string | null): Promise<void> {
    const db = getDB();
    if (!db) return;

    await db.query(
      `UPDATE type::record('folder', $id) SET parent_id = $parent_id`,
      { id, parent_id: parentId },
    );
  },

  async list(): Promise<FolderRecord[]> {
    const db = getDB();
    if (!db) return [];

    const result = await db.query<[FolderRecord[]]>(
      `SELECT id, title, parent_id, sort_order, created_at FROM folder ORDER BY sort_order ASC`,
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
