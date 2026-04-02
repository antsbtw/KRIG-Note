import { getDB } from './client';
import type { INoteStore, NoteRecord, NoteListItem } from './types';

/**
 * NoteStore — NoteFile CRUD
 */

function generateId(): string {
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const noteStore: INoteStore = {
  async create(title?: string): Promise<NoteRecord> {
    const db = getDB();
    if (!db) throw new Error('DB not ready');

    const id = generateId();
    const now = Date.now();
    const record: NoteRecord = {
      id,
      title: title || 'Untitled',
      doc_content: [],
      created_at: now,
      updated_at: now,
    };

    await db.query(
      `CREATE note SET id = $id, title = $title, doc_content = $doc_content, created_at = $created_at, updated_at = $updated_at`,
      { id, title: record.title, doc_content: record.doc_content, created_at: now, updated_at: now },
    );

    return record;
  },

  async get(id: string): Promise<NoteRecord | null> {
    const db = getDB();
    if (!db) return null;

    const result = await db.query<[NoteRecord[]]>(
      `SELECT * FROM note WHERE id = $id LIMIT 1`,
      { id },
    );

    const records = result[0];
    if (!records || records.length === 0) return null;

    const r = records[0];
    return {
      id: String(r.id).replace(/^note:⟨?|⟩?$/g, ''),
      title: r.title || 'Untitled',
      doc_content: r.doc_content || [],
      created_at: r.created_at || 0,
      updated_at: r.updated_at || 0,
    };
  },

  async save(id: string, docContent: unknown[], title: string): Promise<void> {
    const db = getDB();
    if (!db) return;

    const now = Date.now();
    await db.query(
      `UPDATE note SET title = $title, doc_content = $doc_content, updated_at = $updated_at WHERE id = $id`,
      { id, title, doc_content: docContent, updated_at: now },
    );
  },

  async delete(id: string): Promise<void> {
    const db = getDB();
    if (!db) return;

    await db.query(`DELETE FROM note WHERE id = $id`, { id });
  },

  async list(): Promise<NoteListItem[]> {
    const db = getDB();
    if (!db) return [];

    const result = await db.query<[NoteListItem[]]>(
      `SELECT id, title, updated_at FROM note ORDER BY updated_at DESC`,
    );

    const records = result[0] || [];
    return records.map((r) => ({
      id: String(r.id).replace(/^note:⟨?|⟩?$/g, ''),
      title: r.title || 'Untitled',
      updated_at: r.updated_at || 0,
    }));
  },
};
