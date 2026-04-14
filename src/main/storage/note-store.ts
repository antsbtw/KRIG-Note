import { getDB } from './client';
import type { INoteStore, NoteRecord, NoteListItem } from './types';
import { createAtom } from '../../shared/types/atom-types';
import type { Atom, NoteTitleContent, ParagraphContent } from '../../shared/types/atom-types';

/**
 * NoteStore — NoteFile CRUD
 *
 * SurrealDB record id 格式：note:⟨xxx⟩
 * 对外暴露纯字符串 id（不含 table 前缀和角括号）
 *
 * doc_content 存储 Atom[] 格式（不是 ProseMirror JSON）。
 * Atom ↔ PM 转换在 renderer 端的 NoteEditor 中完成。
 */

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 创建空文档的默认 Atom[]（noteTitle + 空段落） */
function createDefaultAtoms(title?: string): Atom[] {
  return [
    createAtom('noteTitle', {
      children: title ? [{ type: 'text', text: title }] : [],
    } as NoteTitleContent),
    createAtom('paragraph', {
      children: [],
    } as ParagraphContent),
  ];
}

/** 清理 SurrealDB record id → 纯字符串 */
function cleanRecordId(raw: unknown): string {
  return String(raw).replace(/^note:⟨?|⟩?$/g, '');
}

export const noteStore: INoteStore = {
  async create(title?: string, folderId?: string | null): Promise<NoteRecord> {
    const db = getDB();
    if (!db) throw new Error('DB not ready');

    const id = generateId();
    const now = Date.now();

    const record: NoteRecord = {
      id,
      title: title || 'Untitled',
      doc_content: createDefaultAtoms(title),
      folder_id: folderId ?? null,
      created_at: now,
      updated_at: now,
    };

    await db.query(
      `CREATE note SET id = $id, title = $title, doc_content = $doc_content, folder_id = $folder_id, created_at = $created_at, updated_at = $updated_at`,
      { id, title: record.title, doc_content: record.doc_content, folder_id: record.folder_id, created_at: now, updated_at: now },
    );

    return record;
  },

  async get(id: string): Promise<NoteRecord | null> {
    const db = getDB();
    if (!db) return null;

    const result = await db.query<[NoteRecord[]]>(
      `SELECT * FROM type::record('note', $id) LIMIT 1`,
      { id },
    );

    const records = result[0];
    if (!records || records.length === 0) return null;

    const r = records[0];
    return {
      id: cleanRecordId(r.id),
      title: r.title || 'Untitled',
      doc_content: r.doc_content || [],
      folder_id: r.folder_id ?? null,
      created_at: r.created_at || 0,
      updated_at: r.updated_at || 0,
    };
  },

  async save(id: string, docContent: unknown[], title: string): Promise<void> {
    const db = getDB();
    if (!db) return;

    const now = Date.now();
    await db.query(
      `UPDATE type::record('note', $id) SET title = $title, doc_content = $doc_content, updated_at = $updated_at`,
      { id, title, doc_content: docContent, updated_at: now },
    );
  },

  async delete(id: string): Promise<void> {
    const db = getDB();
    if (!db) return;

    await db.query(`DELETE type::record('note', $id)`, { id });
  },

  async rename(id: string, title: string): Promise<void> {
    const db = getDB();
    if (!db) return;

    const now = Date.now();
    await db.query(
      `UPDATE type::record('note', $id) SET title = $title, updated_at = $updated_at`,
      { id, title, updated_at: now },
    );
  },

  async moveToFolder(id: string, folderId: string | null): Promise<void> {
    const db = getDB();
    if (!db) return;

    await db.query(
      `UPDATE type::record('note', $id) SET folder_id = $folder_id`,
      { id, folder_id: folderId },
    );
  },

  async list(): Promise<NoteListItem[]> {
    const db = getDB();
    if (!db) return [];

    const result = await db.query<[NoteListItem[]]>(
      `SELECT id, title, folder_id, updated_at FROM note ORDER BY updated_at DESC`,
    );

    const records = result[0] || [];
    return records.map((r) => ({
      id: cleanRecordId(r.id),
      title: r.title || 'Untitled',
      folder_id: r.folder_id ?? null,
      updated_at: r.updated_at || 0,
    }));
  },
};
