import { getDB } from '../../../main/storage/client';

/**
 * Web 书签存储 — SurrealDB 版本
 *
 * 替代原 JSON 文件 bookmark-store.ts。
 * 表：bookmark（书签）、bookmark_folder（书签文件夹）
 */

export interface WebBookmark {
  id: string;
  title: string;
  url: string;
  favicon?: string;
  folderId: string | null;
  createdAt: number;
}

export interface WebBookmarkFolder {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  created_at: number;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanRecordId(raw: unknown, table: string): string {
  const re = new RegExp(`^${table}:⟨?|⟩?$`, 'g');
  return String(raw).replace(re, '');
}

export const bookmarkSurrealStore = {
  // ── 书签操作 ──

  async list(): Promise<WebBookmark[]> {
    const db = getDB();
    if (!db) return [];

    const result = await db.query<[any[]]>(
      `SELECT * FROM bookmark ORDER BY created_at DESC`,
    );
    return (result[0] || []).map(mapBookmarkRecord);
  },

  async add(url: string, title: string, favicon?: string): Promise<WebBookmark> {
    const db = getDB();
    if (!db) throw new Error('DB not ready');

    const id = generateId();
    const now = Date.now();

    await db.query(
      `CREATE bookmark SET id = $id, url = $url, title = $title, favicon = $favicon, folder_id = $folder_id, created_at = $created_at`,
      { id, url, title, favicon: favicon ?? null, folder_id: null, created_at: now },
    );

    return { id, title, url, favicon, folderId: null, createdAt: now };
  },

  async remove(id: string): Promise<void> {
    const db = getDB();
    if (!db) return;
    await db.query(`DELETE type::record('bookmark', $id)`, { id });
  },

  async update(id: string, fields: Partial<Pick<WebBookmark, 'title' | 'url' | 'favicon'>>): Promise<void> {
    const db = getDB();
    if (!db) return;

    const sets: string[] = [];
    const params: Record<string, unknown> = { id };

    if (fields.title !== undefined) { sets.push('title = $title'); params.title = fields.title; }
    if (fields.url !== undefined) { sets.push('url = $url'); params.url = fields.url; }
    if (fields.favicon !== undefined) { sets.push('favicon = $favicon'); params.favicon = fields.favicon; }

    if (sets.length === 0) return;

    await db.query(
      `UPDATE type::record('bookmark', $id) SET ${sets.join(', ')}`,
      params,
    );
  },

  async move(id: string, folderId: string | null): Promise<void> {
    const db = getDB();
    if (!db) return;
    await db.query(
      `UPDATE type::record('bookmark', $id) SET folder_id = $folder_id`,
      { id, folder_id: folderId },
    );
  },

  async findByUrl(url: string): Promise<WebBookmark | null> {
    const db = getDB();
    if (!db) return null;

    const result = await db.query<[any[]]>(
      `SELECT * FROM bookmark WHERE url = $url LIMIT 1`,
      { url },
    );
    const records = result[0];
    if (!records || records.length === 0) return null;
    return mapBookmarkRecord(records[0]);
  },

  // ── 文件夹操作 ──

  async folderList(): Promise<WebBookmarkFolder[]> {
    const db = getDB();
    if (!db) return [];

    const result = await db.query<[any[]]>(
      `SELECT * FROM bookmark_folder ORDER BY sort_order ASC`,
    );
    return (result[0] || []).map((r) => ({
      id: cleanRecordId(r.id, 'bookmark_folder'),
      title: r.title || '',
      parent_id: r.parent_id ?? null,
      sort_order: r.sort_order ?? 0,
      created_at: r.created_at || 0,
    }));
  },

  async folderCreate(title: string, parentId?: string | null): Promise<WebBookmarkFolder> {
    const db = getDB();
    if (!db) throw new Error('DB not ready');

    const id = generateId();
    const now = Date.now();

    const siblings = await db.query<[any[]]>(
      parentId
        ? `SELECT * FROM bookmark_folder WHERE parent_id = $parent_id`
        : `SELECT * FROM bookmark_folder WHERE parent_id = NONE OR parent_id = NULL`,
      { parent_id: parentId ?? null },
    );
    const sortOrder = (siblings[0]?.length ?? 0) + 1;

    await db.query(
      `CREATE bookmark_folder SET id = $id, title = $title, parent_id = $parent_id, sort_order = $sort_order, created_at = $created_at`,
      { id, title, parent_id: parentId ?? null, sort_order: sortOrder, created_at: now },
    );

    return { id, title, parent_id: parentId ?? null, sort_order: sortOrder, created_at: now };
  },

  async folderRename(id: string, title: string): Promise<void> {
    const db = getDB();
    if (!db) return;
    await db.query(
      `UPDATE type::record('bookmark_folder', $id) SET title = $title`,
      { id, title },
    );
  },

  async folderDelete(id: string): Promise<void> {
    const db = getDB();
    if (!db) return;

    // 递归删除子文件夹
    const children = await db.query<[{ id: unknown }[]]>(
      `SELECT id FROM bookmark_folder WHERE parent_id = $id`,
      { id },
    );
    for (const child of (children[0] || [])) {
      await this.folderDelete(cleanRecordId(child.id, 'bookmark_folder'));
    }

    // 书签移到根目录
    await db.query(
      `UPDATE bookmark SET folder_id = NULL WHERE folder_id = $id`,
      { id },
    );

    await db.query(`DELETE type::record('bookmark_folder', $id)`, { id });
  },
};

function mapBookmarkRecord(r: any): WebBookmark {
  return {
    id: cleanRecordId(r.id, 'bookmark'),
    title: r.title || '',
    url: r.url || '',
    favicon: r.favicon ?? undefined,
    folderId: r.folder_id ?? null,
    createdAt: r.created_at || 0,
  };
}
