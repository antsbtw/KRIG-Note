import { getDB } from './client';
import type {
  IGraphIntensionAtomStore,
  GraphIntensionAtomRecord,
  IntensionValueKind,
} from './types';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanRecordId(raw: unknown): string {
  return String(raw).replace(/^[a-z_]+:⟨?|⟩?$/g, '');
}

function mapRecord(r: any): GraphIntensionAtomRecord {
  return {
    id: cleanRecordId(r.id),
    graph_id: r.graph_id,
    subject_id: r.subject_id,
    predicate: r.predicate || '',
    value: r.value ?? '',
    value_kind: (r.value_kind as IntensionValueKind) || 'text',
    sort_order: typeof r.sort_order === 'number' ? r.sort_order : 0,
    created_at: r.created_at || 0,
  };
}

/**
 * graph_intension_atom store — 视图内涵 Atom（语义态）。
 *
 * 每条 atom = 「subject + predicate :: value」三元组。
 * 既可挂几何体（节点 / 边 / 集群 / 体），也可未来挂 graph 主体。
 *
 * 详细规约见 docs/graph/KRIG-Graph-Import-Spec.md §1.4
 */
export const graphIntensionAtomStore: IGraphIntensionAtomStore = {
  async createBulk(records): Promise<void> {
    const db = getDB();
    if (!db) return;
    const now = Date.now();
    for (const r of records) {
      const id = generateId();
      await db.query(
        `CREATE graph_intension_atom SET
          id = $id,
          graph_id = $graph_id,
          subject_id = $subject_id,
          predicate = $predicate,
          value = $value,
          value_kind = $value_kind,
          sort_order = $sort_order,
          created_at = $created_at`,
        {
          id,
          graph_id: r.graph_id,
          subject_id: r.subject_id,
          predicate: r.predicate,
          value: r.value,
          value_kind: r.value_kind,
          sort_order: r.sort_order ?? 0,
          created_at: now,
        },
      );
    }
  },

  async list(graphId: string, subjectId?: string): Promise<GraphIntensionAtomRecord[]> {
    const db = getDB();
    if (!db) return [];
    const sql = subjectId
      ? `SELECT * FROM graph_intension_atom WHERE graph_id = $gid AND subject_id = $sid ORDER BY predicate, sort_order`
      : `SELECT * FROM graph_intension_atom WHERE graph_id = $gid ORDER BY subject_id, predicate, sort_order`;
    const result = await db.query<[any[]]>(sql, { gid: graphId, sid: subjectId });
    return (result[0] || []).map(mapRecord);
  },

  async create(record): Promise<GraphIntensionAtomRecord> {
    const db = getDB();
    if (!db) throw new Error('DB not ready');
    const now = Date.now();
    const id = generateId();
    await db.query(
      `CREATE graph_intension_atom SET
        id = $id,
        graph_id = $graph_id,
        subject_id = $subject_id,
        predicate = $predicate,
        value = $value,
        value_kind = $value_kind,
        sort_order = $sort_order,
        created_at = $created_at`,
      {
        id,
        graph_id: record.graph_id,
        subject_id: record.subject_id,
        predicate: record.predicate,
        value: record.value,
        value_kind: record.value_kind,
        sort_order: record.sort_order ?? 0,
        created_at: now,
      },
    );
    return { ...record, id, created_at: now };
  },

  async update(id: string, fields): Promise<void> {
    const db = getDB();
    if (!db) return;
    const sets: string[] = [];
    const params: Record<string, unknown> = { id };
    if (fields.subject_id !== undefined) { sets.push('subject_id = $subject_id'); params.subject_id = fields.subject_id; }
    if (fields.predicate !== undefined)  { sets.push('predicate = $predicate');   params.predicate = fields.predicate; }
    if (fields.value !== undefined)      { sets.push('value = $value');           params.value = fields.value; }
    if (fields.value_kind !== undefined) { sets.push('value_kind = $value_kind'); params.value_kind = fields.value_kind; }
    if (fields.sort_order !== undefined) { sets.push('sort_order = $sort_order'); params.sort_order = fields.sort_order; }
    if (sets.length === 0) return;
    await db.query(
      `UPDATE type::record('graph_intension_atom', $id) SET ${sets.join(', ')}`,
      params,
    );
  },

  async delete(id: string): Promise<void> {
    const db = getDB();
    if (!db) return;
    await db.query(`DELETE type::record('graph_intension_atom', $id)`, { id });
  },

  async deleteByGraph(graphId: string): Promise<void> {
    const db = getDB();
    if (!db) return;
    await db.query(`DELETE graph_intension_atom WHERE graph_id = $id`, { id: graphId });
  },
};
