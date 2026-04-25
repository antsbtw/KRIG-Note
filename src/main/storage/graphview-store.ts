import { getDB } from './client';
import type { IGraphStore, GraphRecord, GraphListItem, GraphVariant } from './types';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanRecordId(raw: unknown): string {
  return String(raw).replace(/^graph:⟨?|⟩?$/g, '');
}

const DEFAULT_VARIANT: GraphVariant = 'knowledge';

export const graphViewStore: IGraphStore = {
  async create(title?: string, hostNoteId?: string | null, variant?: GraphVariant): Promise<GraphRecord> {
    const db = getDB();
    if (!db) throw new Error('DB not ready');

    const id = generateId();
    const now = Date.now();
    const record: GraphRecord = {
      id,
      title: title ?? '未命名图谱',
      variant: variant ?? DEFAULT_VARIANT,
      host_note_id: hostNoteId ?? null,
      created_at: now,
      updated_at: now,
      meta: {},
    };

    await db.query(
      `CREATE graph SET id = $id, title = $title, variant = $variant, host_note_id = $host_note_id, created_at = $created_at, updated_at = $updated_at, meta = $meta`,
      {
        id: record.id,
        title: record.title,
        variant: record.variant,
        host_note_id: record.host_note_id,
        created_at: record.created_at,
        updated_at: record.updated_at,
        meta: record.meta ?? {},
      },
    );

    return record;
  },

  async get(id: string): Promise<GraphRecord | null> {
    const db = getDB();
    if (!db) return null;

    const result = await db.query<[GraphRecord[]]>(
      `SELECT * FROM type::record('graph', $id) LIMIT 1`,
      { id },
    );
    const r = result[0]?.[0];
    if (!r) return null;
    return {
      id: cleanRecordId(r.id),
      title: r.title || '未命名图谱',
      variant: (r.variant as GraphVariant) || DEFAULT_VARIANT,
      host_note_id: r.host_note_id ?? null,
      created_at: r.created_at || 0,
      updated_at: r.updated_at || 0,
      meta: r.meta ?? {},
    };
  },

  async list(): Promise<GraphListItem[]> {
    const db = getDB();
    if (!db) return [];

    const result = await db.query<[GraphListItem[]]>(
      `SELECT id, title, variant, host_note_id, updated_at FROM graph ORDER BY updated_at DESC`,
    );
    const rows = result[0] || [];
    return rows.map((r) => ({
      id: cleanRecordId(r.id),
      title: r.title || '未命名图谱',
      variant: (r.variant as GraphVariant) || DEFAULT_VARIANT,
      host_note_id: r.host_note_id ?? null,
      updated_at: r.updated_at || 0,
    }));
  },

  async rename(id: string, title: string): Promise<void> {
    const db = getDB();
    if (!db) return;
    await db.query(
      `UPDATE type::record('graph', $id) SET title = $title, updated_at = $updated_at`,
      { id, title, updated_at: Date.now() },
    );
  },

  async setVariant(id: string, variant: GraphVariant): Promise<void> {
    const db = getDB();
    if (!db) return;
    await db.query(
      `UPDATE type::record('graph', $id) SET variant = $variant, updated_at = $updated_at`,
      { id, variant, updated_at: Date.now() },
    );
  },

  async setHostNote(id: string, hostNoteId: string | null): Promise<void> {
    const db = getDB();
    if (!db) return;
    await db.query(
      `UPDATE type::record('graph', $id) SET host_note_id = $host_note_id, updated_at = $updated_at`,
      { id, host_note_id: hostNoteId, updated_at: Date.now() },
    );
  },

  async delete(id: string): Promise<void> {
    const db = getDB();
    if (!db) return;
    await db.query(`DELETE type::record('graph', $id)`, { id });
  },
};
