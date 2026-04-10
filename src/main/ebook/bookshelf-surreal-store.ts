import { app } from 'electron';
import { existsSync, copyFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { getDB } from '../storage/client';

/**
 * eBook 书架存储 — SurrealDB 版本
 *
 * 替代原 JSON 文件 bookshelf-store.ts。
 * 表：ebook（书籍条目）、ebook_folder（书架文件夹）
 */

// ── 数据模型（与原 JSON 版本兼容） ──

export interface ReadingPosition {
  page?: number;
  scale?: number;
  fitWidth?: boolean;
  cfi?: string;
}

export interface EBookEntry {
  id: string;
  fileType: 'pdf' | 'epub' | 'djvu' | 'cbz';
  storage: 'link' | 'managed';
  filePath: string;
  originalPath?: string;
  fileName: string;
  displayName: string;
  pageCount?: number;
  folderId: string | null;
  addedAt: number;
  lastOpenedAt: number;
  lastPosition?: ReadingPosition;
  bookmarks?: number[];
  cfiBookmarks?: Array<{ cfi: string; label: string }>;
}

export interface EBookFolder {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  created_at: number;
}

// ── Helpers ──

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanRecordId(raw: unknown, table: string): string {
  const re = new RegExp(`^${table}:⟨?|⟩?$`, 'g');
  return String(raw).replace(re, '');
}

function getLibraryDir(): string {
  const dir = path.join(app.getPath('userData'), 'krig-note', 'ebook', 'library');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Store ──

export const ebookStore = {
  // ── 书本操作 ──

  async list(): Promise<EBookEntry[]> {
    const db = getDB();
    if (!db) return [];

    const result = await db.query<[any[]]>(
      `SELECT * FROM ebook ORDER BY last_opened_at DESC`,
    );
    return (result[0] || []).map(mapEBookRecord);
  },

  async get(id: string): Promise<EBookEntry | null> {
    const db = getDB();
    if (!db) return null;

    const result = await db.query<[any[]]>(
      `SELECT * FROM type::record('ebook', $id) LIMIT 1`,
      { id },
    );
    const records = result[0];
    if (!records || records.length === 0) return null;
    return mapEBookRecord(records[0]);
  },

  async addManaged(srcPath: string, fileType: EBookEntry['fileType'], pageCount?: number): Promise<EBookEntry> {
    const db = getDB();
    if (!db) throw new Error('DB not ready');

    const id = generateId();
    const ext = path.extname(srcPath);
    const destPath = path.join(getLibraryDir(), `${id}${ext}`);
    copyFileSync(srcPath, destPath);

    const now = Date.now();
    const entry: EBookEntry = {
      id, fileType, storage: 'managed',
      filePath: destPath, originalPath: srcPath,
      fileName: path.basename(srcPath),
      displayName: path.basename(srcPath, ext),
      pageCount, folderId: null,
      addedAt: now, lastOpenedAt: now,
    };

    await db.query(
      `CREATE ebook SET id = $id, file_type = $file_type, storage = $storage, file_path = $file_path, original_path = $original_path, file_name = $file_name, display_name = $display_name, page_count = $page_count, folder_id = $folder_id, added_at = $added_at, last_opened_at = $last_opened_at`,
      {
        id, file_type: fileType, storage: 'managed',
        file_path: destPath, original_path: srcPath,
        file_name: entry.fileName, display_name: entry.displayName,
        page_count: pageCount ?? null, folder_id: null,
        added_at: now, last_opened_at: now,
      },
    );

    return entry;
  },

  async addLinked(srcPath: string, fileType: EBookEntry['fileType'], pageCount?: number): Promise<EBookEntry> {
    const db = getDB();
    if (!db) throw new Error('DB not ready');

    const id = generateId();
    const ext = path.extname(srcPath);
    const now = Date.now();

    const entry: EBookEntry = {
      id, fileType, storage: 'link',
      filePath: srcPath,
      fileName: path.basename(srcPath),
      displayName: path.basename(srcPath, ext),
      pageCount, folderId: null,
      addedAt: now, lastOpenedAt: now,
    };

    await db.query(
      `CREATE ebook SET id = $id, file_type = $file_type, storage = $storage, file_path = $file_path, file_name = $file_name, display_name = $display_name, page_count = $page_count, folder_id = $folder_id, added_at = $added_at, last_opened_at = $last_opened_at`,
      {
        id, file_type: fileType, storage: 'link',
        file_path: srcPath,
        file_name: entry.fileName, display_name: entry.displayName,
        page_count: pageCount ?? null, folder_id: null,
        added_at: now, last_opened_at: now,
      },
    );

    return entry;
  },

  async remove(id: string): Promise<void> {
    const db = getDB();
    if (!db) return;

    // 如果是 managed，删除本地文件
    const entry = await this.get(id);
    if (entry?.storage === 'managed' && existsSync(entry.filePath)) {
      try { unlinkSync(entry.filePath); } catch { /* ignore */ }
    }

    await db.query(`DELETE type::record('ebook', $id)`, { id });
  },

  async rename(id: string, displayName: string): Promise<void> {
    const db = getDB();
    if (!db) return;
    await db.query(
      `UPDATE type::record('ebook', $id) SET display_name = $display_name`,
      { id, display_name: displayName },
    );
  },

  async moveToFolder(id: string, folderId: string | null): Promise<void> {
    const db = getDB();
    if (!db) return;
    await db.query(
      `UPDATE type::record('ebook', $id) SET folder_id = $folder_id`,
      { id, folder_id: folderId },
    );
  },

  async updateOpened(id: string): Promise<void> {
    const db = getDB();
    if (!db) return;
    await db.query(
      `UPDATE type::record('ebook', $id) SET last_opened_at = $now`,
      { id, now: Date.now() },
    );
  },

  async toggleBookmark(id: string, page: number): Promise<number[]> {
    const db = getDB();
    if (!db) return [];

    const entry = await this.get(id);
    if (!entry) return [];

    const bookmarks = entry.bookmarks ?? [];
    const idx = bookmarks.indexOf(page);
    if (idx >= 0) {
      bookmarks.splice(idx, 1);
    } else {
      bookmarks.push(page);
      bookmarks.sort((a, b) => a - b);
    }

    await db.query(
      `UPDATE type::record('ebook', $id) SET bookmarks = $bookmarks`,
      { id, bookmarks },
    );
    return bookmarks;
  },

  async getBookmarks(id: string): Promise<number[]> {
    const entry = await this.get(id);
    return entry?.bookmarks ?? [];
  },

  async addCFIBookmark(id: string, cfi: string, label: string): Promise<Array<{ cfi: string; label: string }>> {
    const db = getDB();
    if (!db) return [];

    const entry = await this.get(id);
    if (!entry) return [];

    const cfiBookmarks = entry.cfiBookmarks ?? [];
    if (cfiBookmarks.some((b) => b.cfi === cfi)) return cfiBookmarks;
    cfiBookmarks.push({ cfi, label });

    await db.query(
      `UPDATE type::record('ebook', $id) SET cfi_bookmarks = $cfi_bookmarks`,
      { id, cfi_bookmarks: cfiBookmarks },
    );
    return cfiBookmarks;
  },

  async removeCFIBookmark(id: string, cfi: string): Promise<Array<{ cfi: string; label: string }>> {
    const db = getDB();
    if (!db) return [];

    const entry = await this.get(id);
    if (!entry || !entry.cfiBookmarks) return [];

    const cfiBookmarks = entry.cfiBookmarks.filter((b) => b.cfi !== cfi);
    await db.query(
      `UPDATE type::record('ebook', $id) SET cfi_bookmarks = $cfi_bookmarks`,
      { id, cfi_bookmarks: cfiBookmarks },
    );
    return cfiBookmarks;
  },

  async getCFIBookmarks(id: string): Promise<Array<{ cfi: string; label: string }>> {
    const entry = await this.get(id);
    return entry?.cfiBookmarks ?? [];
  },

  async updateProgress(id: string, position: ReadingPosition): Promise<void> {
    const db = getDB();
    if (!db) return;

    const entry = await this.get(id);
    if (!entry) return;

    const merged = { ...entry.lastPosition, ...position };
    await db.query(
      `UPDATE type::record('ebook', $id) SET last_position = $last_position`,
      { id, last_position: merged },
    );
  },

  async checkExists(id: string): Promise<boolean> {
    const entry = await this.get(id);
    if (!entry) return false;
    try { await stat(entry.filePath); return true; } catch { return false; }
  },

  // ── 文件夹操作 ──

  async folderList(): Promise<EBookFolder[]> {
    const db = getDB();
    if (!db) return [];

    const result = await db.query<[any[]]>(
      `SELECT * FROM ebook_folder ORDER BY sort_order ASC`,
    );
    return (result[0] || []).map((r) => ({
      id: cleanRecordId(r.id, 'ebook_folder'),
      title: r.title || '',
      parent_id: r.parent_id ?? null,
      sort_order: r.sort_order ?? 0,
      created_at: r.created_at || 0,
    }));
  },

  async folderCreate(title: string, parentId?: string | null): Promise<EBookFolder> {
    const db = getDB();
    if (!db) throw new Error('DB not ready');

    const id = generateId();
    const now = Date.now();

    const siblings = await db.query<[any[]]>(
      parentId
        ? `SELECT * FROM ebook_folder WHERE parent_id = $parent_id`
        : `SELECT * FROM ebook_folder WHERE parent_id = NONE OR parent_id = NULL`,
      { parent_id: parentId ?? null },
    );
    const sortOrder = (siblings[0]?.length ?? 0) + 1;

    const folder: EBookFolder = {
      id, title, parent_id: parentId ?? null,
      sort_order: sortOrder, created_at: now,
    };

    await db.query(
      `CREATE ebook_folder SET id = $id, title = $title, parent_id = $parent_id, sort_order = $sort_order, created_at = $created_at`,
      { id, title, parent_id: folder.parent_id, sort_order: sortOrder, created_at: now },
    );

    return folder;
  },

  async folderRename(id: string, title: string): Promise<void> {
    const db = getDB();
    if (!db) return;
    await db.query(
      `UPDATE type::record('ebook_folder', $id) SET title = $title`,
      { id, title },
    );
  },

  async folderDelete(id: string): Promise<void> {
    const db = getDB();
    if (!db) return;

    // 递归删除子文件夹
    const children = await db.query<[{ id: unknown }[]]>(
      `SELECT id FROM ebook_folder WHERE parent_id = $id`,
      { id },
    );
    for (const child of (children[0] || [])) {
      await this.folderDelete(cleanRecordId(child.id, 'ebook_folder'));
    }

    // 该文件夹下的书本移到根目录
    await db.query(
      `UPDATE ebook SET folder_id = NULL WHERE folder_id = $id`,
      { id },
    );

    await db.query(`DELETE type::record('ebook_folder', $id)`, { id });
  },

  async folderMove(id: string, parentId: string | null): Promise<void> {
    const db = getDB();
    if (!db) return;
    await db.query(
      `UPDATE type::record('ebook_folder', $id) SET parent_id = $parent_id`,
      { id, parent_id: parentId },
    );
  },
};

// ── Record → EBookEntry 映射 ──

function mapEBookRecord(r: any): EBookEntry {
  return {
    id: cleanRecordId(r.id, 'ebook'),
    fileType: r.file_type,
    storage: r.storage,
    filePath: r.file_path,
    originalPath: r.original_path,
    fileName: r.file_name,
    displayName: r.display_name,
    pageCount: r.page_count,
    folderId: r.folder_id ?? null,
    addedAt: r.added_at || 0,
    lastOpenedAt: r.last_opened_at || 0,
    lastPosition: r.last_position,
    bookmarks: r.bookmarks,
    cfiBookmarks: r.cfi_bookmarks,
  };
}
