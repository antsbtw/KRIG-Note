import { getDB } from './client';
import type {
  IGraphPresentationAtomStore,
  GraphPresentationAtomRecord,
  PresentationValueKind,
} from './types';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanRecordId(raw: unknown): string {
  return String(raw).replace(/^[a-z_]+:⟨?|⟩?$/g, '');
}

function mapRecord(r: any): GraphPresentationAtomRecord {
  return {
    id: cleanRecordId(r.id),
    graph_id: r.graph_id,
    layout_id: r.layout_id || '*',
    subject_id: r.subject_id,
    attribute: r.attribute || '',
    value: r.value ?? '',
    value_kind: (r.value_kind as PresentationValueKind) || 'text',
    updated_at: r.updated_at || 0,
  };
}

/**
 * graph_presentation_atom store — 视图属性 Atom（视觉态）。
 *
 * 每条 atom = 「layout_id + subject + attribute :: value」。
 * `layout_id = '*'` 表跨布局通用（如颜色），其他 layout id 表布局专属（如 position）。
 *
 * 详细规约见 docs/graph/KRIG-Graph-Import-Spec.md §1.5
 */
export const graphPresentationAtomStore: IGraphPresentationAtomStore = {
  async list(graphId: string, layoutIds?: string[]): Promise<GraphPresentationAtomRecord[]> {
    const db = getDB();
    if (!db) return [];
    const sql = layoutIds && layoutIds.length > 0
      ? `SELECT * FROM graph_presentation_atom WHERE graph_id = $gid AND layout_id IN $layouts`
      : `SELECT * FROM graph_presentation_atom WHERE graph_id = $gid`;
    const result = await db.query<[any[]]>(sql, { gid: graphId, layouts: layoutIds });
    return (result[0] || []).map(mapRecord);
  },

  async set(record): Promise<void> {
    const db = getDB();
    if (!db) return;
    const now = Date.now();
    // upsert：先查 (graph_id, layout_id, subject_id, attribute) 是否存在
    const existing = await db.query<[any[]]>(
      `SELECT id FROM graph_presentation_atom
        WHERE graph_id = $gid AND layout_id = $lid AND subject_id = $sid AND attribute = $attr
        LIMIT 1`,
      {
        gid: record.graph_id,
        lid: record.layout_id,
        sid: record.subject_id,
        attr: record.attribute,
      },
    );
    const existingId = existing[0]?.[0]?.id;

    if (existingId) {
      const cleanId = cleanRecordId(existingId);
      await db.query(
        `UPDATE type::record('graph_presentation_atom', $id) SET
          value = $value,
          value_kind = $value_kind,
          updated_at = $updated_at`,
        {
          id: cleanId,
          value: record.value,
          value_kind: record.value_kind,
          updated_at: now,
        },
      );
    } else {
      const id = generateId();
      await db.query(
        `CREATE graph_presentation_atom SET
          id = $id,
          graph_id = $graph_id,
          layout_id = $layout_id,
          subject_id = $subject_id,
          attribute = $attribute,
          value = $value,
          value_kind = $value_kind,
          updated_at = $updated_at`,
        {
          id,
          graph_id: record.graph_id,
          layout_id: record.layout_id,
          subject_id: record.subject_id,
          attribute: record.attribute,
          value: record.value,
          value_kind: record.value_kind,
          updated_at: now,
        },
      );
    }
  },

  async setBulk(records): Promise<void> {
    // 简单实现：遍历单条 set。后续可优化为批量 upsert（SurrealDB 暂无原生 upsert）
    for (const r of records) {
      await this.set(r);
    }
  },

  async delete(graphId, layoutId, subjectId, attribute): Promise<void> {
    const db = getDB();
    if (!db) return;
    await db.query(
      `DELETE graph_presentation_atom
        WHERE graph_id = $gid AND layout_id = $lid AND subject_id = $sid AND attribute = $attr`,
      { gid: graphId, lid: layoutId, sid: subjectId, attr: attribute },
    );
  },

  async clearByLayout(graphId: string, layoutId: string): Promise<void> {
    const db = getDB();
    if (!db) return;
    await db.query(
      `DELETE graph_presentation_atom WHERE graph_id = $gid AND layout_id = $lid`,
      { gid: graphId, lid: layoutId },
    );
  },

  async deleteByGraph(graphId: string): Promise<void> {
    const db = getDB();
    if (!db) return;
    await db.query(
      `DELETE graph_presentation_atom WHERE graph_id = $id`,
      { id: graphId },
    );
  },
};
