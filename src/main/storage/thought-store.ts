import { getDB } from './client';
import type { ThoughtRecord, IThoughtStore } from '../../shared/types/thought-types';

/**
 * ThoughtStore — Thought CRUD
 *
 * SurrealDB record id 格式：thought:⟨xxx⟩
 * 对外暴露纯字符串 id（不含 table 前缀和角括号）
 *
 * doc_content 存储 Atom[] 格式，与 NoteStore 一致。
 */

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanRecordId(raw: unknown): string {
  return String(raw).replace(/^thought:⟨?|⟩?$/g, '');
}

function parseRecord(r: any): ThoughtRecord {
  return {
    id: cleanRecordId(r.id),
    anchor_type: r.anchor_type,
    anchor_text: r.anchor_text || '',
    anchor_pos: r.anchor_pos ?? 0,
    type: r.type || 'thought',
    resolved: r.resolved ?? false,
    pinned: r.pinned ?? false,
    doc_content: r.doc_content || [],
    created_at: r.created_at || 0,
    updated_at: r.updated_at || 0,
  };
}

export const thoughtStore: IThoughtStore = {
  async create(thought): Promise<ThoughtRecord> {
    const db = getDB();
    if (!db) throw new Error('DB not ready');

    const id = generateId();
    const now = Date.now();

    const record: ThoughtRecord = {
      id,
      anchor_type: thought.anchor_type,
      anchor_text: thought.anchor_text,
      anchor_pos: thought.anchor_pos,
      type: thought.type,
      resolved: thought.resolved,
      pinned: thought.pinned,
      doc_content: thought.doc_content,
      created_at: now,
      updated_at: now,
    };

    await db.query(
      `CREATE thought SET id = $id, anchor_type = $anchor_type, anchor_text = $anchor_text, anchor_pos = $anchor_pos, type = $type, resolved = $resolved, pinned = $pinned, doc_content = $doc_content, created_at = $created_at, updated_at = $updated_at`,
      {
        id,
        anchor_type: record.anchor_type,
        anchor_text: record.anchor_text,
        anchor_pos: record.anchor_pos,
        type: record.type,
        resolved: record.resolved,
        pinned: record.pinned,
        doc_content: record.doc_content,
        created_at: now,
        updated_at: now,
      },
    );

    return record;
  },

  async get(id: string): Promise<ThoughtRecord | null> {
    const db = getDB();
    if (!db) return null;

    const result = await db.query<[ThoughtRecord[]]>(
      `SELECT * FROM type::record('thought', $id) LIMIT 1`,
      { id },
    );

    const records = result[0];
    if (!records || records.length === 0) return null;

    return parseRecord(records[0]);
  },

  async save(id: string, updates: Partial<ThoughtRecord>): Promise<void> {
    const db = getDB();
    if (!db) return;

    const now = Date.now();
    const fields: string[] = ['updated_at = $updated_at'];
    const params: Record<string, unknown> = { id, updated_at: now };

    if (updates.doc_content !== undefined) {
      fields.push('doc_content = $doc_content');
      params.doc_content = updates.doc_content;
    }
    if (updates.type !== undefined) {
      fields.push('type = $type');
      params.type = updates.type;
    }
    if (updates.resolved !== undefined) {
      fields.push('resolved = $resolved');
      params.resolved = updates.resolved;
    }
    if (updates.pinned !== undefined) {
      fields.push('pinned = $pinned');
      params.pinned = updates.pinned;
    }
    if (updates.anchor_pos !== undefined) {
      fields.push('anchor_pos = $anchor_pos');
      params.anchor_pos = updates.anchor_pos;
    }

    await db.query(
      `UPDATE type::record('thought', $id) SET ${fields.join(', ')}`,
      params,
    );
  },

  async delete(id: string): Promise<void> {
    const db = getDB();
    if (!db) return;

    await db.query(`DELETE type::record('thought', $id)`, { id });
  },

  async listByNote(noteId: string): Promise<ThoughtRecord[]> {
    const db = getDB();
    if (!db) return [];

    // 通过图关系获取 thought ID 列表，再逐个查询完整记录
    // （SurrealDB 的 SELECT out.* ... ORDER BY out.field 语法有限制）
    const result = await db.query<[any[]]>(
      `SELECT out.id AS thought_id FROM thought_of WHERE in = type::record('note', $noteId)`,
      { noteId },
    );

    const edges = result[0] || [];
    if (edges.length === 0) return [];

    const thoughts: ThoughtRecord[] = [];
    for (const e of edges) {
      const id = cleanRecordId(e.thought_id);
      const r = await thoughtStore.get(id);
      if (r) thoughts.push(r);
    }

    thoughts.sort((a, b) => a.anchor_pos - b.anchor_pos);
    return thoughts;
  },
};
