import { getDB } from '../storage/client';

/**
 * VocabularyStore — 生词本 CRUD（SurrealDB）
 */

export interface VocabEntry {
  id: string;
  word: string;
  definition: string;
  context?: string;
  phonetic?: string;
  createdAt: number;
}

function cleanId(raw: string): string {
  return raw.replace(/^vocab:⟨?/, '').replace(/⟩?$/, '');
}

function toEntry(row: any): VocabEntry {
  return {
    id: cleanId(String(row.id)),
    word: row.word,
    definition: row.definition,
    context: row.context || undefined,
    phonetic: row.phonetic || undefined,
    createdAt: row.created_at,
  };
}

export const vocabStore = {
  async add(
    word: string,
    definition: string,
    context?: string,
    phonetic?: string,
  ): Promise<VocabEntry | null> {
    const db = getDB();
    if (!db) return null;

    const normalized = word.toLowerCase().trim();
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const [row] = await db.query<any[]>(
      `CREATE vocab:⟨${id}⟩ SET word = $word, definition = $definition, context = $context, phonetic = $phonetic, created_at = $ts`,
      { word: normalized, definition, context: context || null, phonetic: phonetic || null, ts: Date.now() },
    );

    if (!row || (Array.isArray(row) && row.length === 0)) return null;
    const created = Array.isArray(row) ? row[0] : row;
    return toEntry(created);
  },

  async remove(id: string): Promise<void> {
    const db = getDB();
    if (!db) return;
    await db.query(`DELETE vocab:⟨${id}⟩`);
  },

  async list(): Promise<VocabEntry[]> {
    const db = getDB();
    if (!db) return [];

    const [rows] = await db.query<any[]>('SELECT * FROM vocab ORDER BY created_at DESC');
    if (!Array.isArray(rows)) return [];
    return rows.map(toEntry);
  },

  async has(word: string): Promise<boolean> {
    const db = getDB();
    if (!db) return false;

    const normalized = word.toLowerCase().trim();
    const [rows] = await db.query<any[]>(
      'SELECT id FROM vocab WHERE word = $word LIMIT 1',
      { word: normalized },
    );
    return Array.isArray(rows) && rows.length > 0;
  },
};
