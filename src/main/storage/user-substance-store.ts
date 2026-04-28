/**
 * user_substance store — B4.3 画板凝结的 substance 持久化。
 *
 * 用户在 Inspector "凝结为 Substance" 创建的产物存这里：
 *   - origin = 'user'
 *   - canvas_snapshot 记录选区几何体 + 视觉编排
 *
 * 启动时（initSchema 之后）由 substance bootstrap 加载 → 注册到 substanceLibrary。
 * Spec：docs/graph/KRIG-Graph-Canvas-Spec.md §4
 */
import { getDB } from './client';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanRecordId(raw: unknown): string {
  return String(raw).replace(/^[a-z_]+:⟨?|⟩?$/g, '');
}

/** DB 里存的最小记录形态（schemaless：data 字段是完整 Substance JSON） */
export interface UserSubstanceRecord {
  /** DB record id（不等于 substance.id） */
  id: string;
  /** Substance.id（用户可见的 substance 唯一标识） */
  substance_id: string;
  label: string;
  /** 完整 Substance 对象的 JSON 序列化 */
  data: string;
  created_at: number;
  updated_at: number;
}

function mapRecord(r: any): UserSubstanceRecord {
  return {
    id: cleanRecordId(r.id),
    substance_id: String(r.substance_id),
    label: String(r.label ?? ''),
    data: String(r.data ?? '{}'),
    created_at: typeof r.created_at === 'number' ? r.created_at : 0,
    updated_at: typeof r.updated_at === 'number' ? r.updated_at : 0,
  };
}

export interface IUserSubstanceStore {
  list(): Promise<UserSubstanceRecord[]>;
  /** 创建：若 substance_id 已存在则报错；调用方先检查 */
  create(input: { substance_id: string; label: string; data: string }): Promise<UserSubstanceRecord>;
  /** 更新：按 substance_id 找记录改 data + label */
  update(substance_id: string, fields: { label?: string; data?: string }): Promise<void>;
  delete(substance_id: string): Promise<void>;
  getBySubstanceId(substance_id: string): Promise<UserSubstanceRecord | null>;
}

export const userSubstanceStore: IUserSubstanceStore = {
  async list(): Promise<UserSubstanceRecord[]> {
    const db = getDB();
    if (!db) return [];
    const result = await db.query<[any[]]>(`SELECT * FROM user_substance`);
    return (result[0] || []).map(mapRecord);
  },

  async create(input): Promise<UserSubstanceRecord> {
    const db = getDB();
    if (!db) throw new Error('DB not ready');
    const now = Date.now();
    const id = generateId();
    await db.query(
      `CREATE user_substance SET
        id = $id,
        substance_id = $sid,
        label = $label,
        data = $data,
        created_at = $now,
        updated_at = $now`,
      {
        id,
        sid: input.substance_id,
        label: input.label,
        data: input.data,
        now,
      },
    );
    return {
      id,
      substance_id: input.substance_id,
      label: input.label,
      data: input.data,
      created_at: now,
      updated_at: now,
    };
  },

  async update(substance_id, fields): Promise<void> {
    const db = getDB();
    if (!db) return;
    const existing = await db.query<[any[]]>(
      `SELECT id FROM user_substance WHERE substance_id = $sid LIMIT 1`,
      { sid: substance_id },
    );
    const recId = existing[0]?.[0]?.id;
    if (!recId) return;
    const cleanId = cleanRecordId(recId);
    const now = Date.now();
    const sets: string[] = ['updated_at = $now'];
    const params: Record<string, unknown> = { id: cleanId, now };
    if (fields.label !== undefined) {
      sets.push('label = $label');
      params.label = fields.label;
    }
    if (fields.data !== undefined) {
      sets.push('data = $data');
      params.data = fields.data;
    }
    await db.query(
      `UPDATE type::record('user_substance', $id) SET ${sets.join(', ')}`,
      params,
    );
  },

  async delete(substance_id): Promise<void> {
    const db = getDB();
    if (!db) return;
    await db.query(`DELETE user_substance WHERE substance_id = $sid`, { sid: substance_id });
  },

  async getBySubstanceId(substance_id): Promise<UserSubstanceRecord | null> {
    const db = getDB();
    if (!db) return null;
    const result = await db.query<[any[]]>(
      `SELECT * FROM user_substance WHERE substance_id = $sid LIMIT 1`,
      { sid: substance_id },
    );
    const r = result[0]?.[0];
    return r ? mapRecord(r) : null;
  },
};
