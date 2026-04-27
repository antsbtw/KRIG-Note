import { getDB } from './client';
import type {
  IGraphGeometryStore,
  GraphGeometryRecord,
  GeometryKind,
} from './types';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanRecordId(raw: unknown): string {
  return String(raw).replace(/^[a-z_]+:⟨?|⟩?$/g, '');
}

function mapRecord(r: any): GraphGeometryRecord {
  return {
    id: cleanRecordId(r.id),
    graph_id: r.graph_id,
    kind: (r.kind as GeometryKind) ?? 'point',
    members: Array.isArray(r.members) ? r.members : [],
    created_at: r.created_at || 0,
  };
}

/**
 * graph_geometry store — 几何骨架（数学态）。
 *
 * 表存储 4 种几何体（point/line/surface/volume）的骨架：id / graph_id / kind / members。
 * 几何体的"看起来怎样"（颜色、位置等）由 graph_presentation_atom 提供；
 * "是什么"（标签、类型、关系等）由 graph_intension_atom 提供。
 */
export const graphGeometryStore: IGraphGeometryStore = {
  async createBulk(records): Promise<void> {
    const db = getDB();
    if (!db) return;
    const now = Date.now();
    // 单条 insert（SurrealDB 暂不直接支持 multi-row insert with custom id）
    for (const r of records) {
      await db.query(
        `CREATE graph_geometry SET
          id = $id,
          graph_id = $graph_id,
          kind = $kind,
          members = $members,
          created_at = $created_at`,
        {
          id: r.id,
          graph_id: r.graph_id,
          kind: r.kind,
          members: r.members ?? [],
          created_at: now,
        },
      );
    }
  },

  async list(graphId: string): Promise<GraphGeometryRecord[]> {
    const db = getDB();
    if (!db) return [];
    const result = await db.query<[any[]]>(
      `SELECT * FROM graph_geometry WHERE graph_id = $id`,
      { id: graphId },
    );
    return (result[0] || []).map(mapRecord);
  },

  async create(record): Promise<GraphGeometryRecord> {
    const db = getDB();
    if (!db) throw new Error('DB not ready');
    const now = Date.now();
    const id = record.id || generateId();
    await db.query(
      `CREATE graph_geometry SET
        id = $id,
        graph_id = $graph_id,
        kind = $kind,
        members = $members,
        created_at = $created_at`,
      {
        id,
        graph_id: record.graph_id,
        kind: record.kind,
        members: record.members ?? [],
        created_at: now,
      },
    );
    return { ...record, id, created_at: now };
  },

  async delete(id: string): Promise<void> {
    const db = getDB();
    if (!db) return;
    await db.query(`DELETE type::record('graph_geometry', $id)`, { id });
    // 级联：删该几何体相关的 atoms
    await db.query(`DELETE graph_intension_atom WHERE subject_id = $id`, { id });
    await db.query(`DELETE graph_presentation_atom WHERE subject_id = $id`, { id });
  },

  async deleteByGraph(graphId: string): Promise<void> {
    const db = getDB();
    if (!db) return;
    await db.query(`DELETE graph_geometry WHERE graph_id = $id`, { id: graphId });
  },
};
