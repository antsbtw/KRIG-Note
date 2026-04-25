import { getDB } from './client';
import type {
  IGraphStore,
  GraphRecord,
  GraphListItem,
  GraphVariant,
  GraphNodeRecord,
  GraphEdgeRecord,
} from './types';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanRecordId(raw: unknown): string {
  // 适配 graph: / graph_node: / graph_edge: 任意表前缀
  return String(raw).replace(/^[a-z_]+:⟨?|⟩?$/g, '');
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
    // 级联删除该图的所有节点和边
    await db.query(`DELETE graph_node WHERE graph_id = $id`, { id });
    await db.query(`DELETE graph_edge WHERE graph_id = $id`, { id });
    await db.query(`DELETE type::record('graph', $id)`, { id });
  },

  // ── 节点/边 CRUD ──

  async loadGraphData(graphId: string): Promise<{ nodes: GraphNodeRecord[]; edges: GraphEdgeRecord[] }> {
    const db = getDB();
    if (!db) return { nodes: [], edges: [] };

    const [nodeResult, edgeResult] = await Promise.all([
      db.query<[GraphNodeRecord[]]>(`SELECT * FROM graph_node WHERE graph_id = $id`, { id: graphId }),
      db.query<[GraphEdgeRecord[]]>(`SELECT * FROM graph_edge WHERE graph_id = $id`, { id: graphId }),
    ]);

    const nodes = (nodeResult[0] || []).map((r) => ({
      id: cleanRecordId(r.id),
      graph_id: r.graph_id,
      type: r.type || 'concept',
      label: r.label || '',
      position_x: r.position_x ?? 0,
      position_y: r.position_y ?? 0,
      block_ids: r.block_ids ?? [],
      meta: r.meta ?? {},
    }));

    const edges = (edgeResult[0] || []).map((r) => ({
      id: cleanRecordId(r.id),
      graph_id: r.graph_id,
      type: r.type,
      source: r.source,
      target: r.target,
      label: r.label,
      meta: r.meta ?? {},
    }));

    return { nodes, edges };
  },

  async saveNode(node: GraphNodeRecord): Promise<void> {
    const db = getDB();
    if (!db) return;
    // upsert：先尝试更新，不存在则创建
    const existing = await db.query<[GraphNodeRecord[]]>(
      `SELECT id FROM type::record('graph_node', $id) LIMIT 1`,
      { id: node.id },
    );
    const exists = (existing[0]?.length ?? 0) > 0;

    if (exists) {
      await db.query(
        `UPDATE type::record('graph_node', $id) SET
          graph_id = $graph_id,
          type = $type,
          label = $label,
          position_x = $position_x,
          position_y = $position_y,
          block_ids = $block_ids,
          meta = $meta`,
        {
          id: node.id,
          graph_id: node.graph_id,
          type: node.type,
          label: node.label,
          position_x: node.position_x,
          position_y: node.position_y,
          block_ids: node.block_ids ?? [],
          meta: node.meta ?? {},
        },
      );
    } else {
      await db.query(
        `CREATE graph_node SET
          id = $id,
          graph_id = $graph_id,
          type = $type,
          label = $label,
          position_x = $position_x,
          position_y = $position_y,
          block_ids = $block_ids,
          meta = $meta`,
        {
          id: node.id,
          graph_id: node.graph_id,
          type: node.type,
          label: node.label,
          position_x: node.position_x,
          position_y: node.position_y,
          block_ids: node.block_ids ?? [],
          meta: node.meta ?? {},
        },
      );
    }
    // touch graph.updated_at
    await db.query(
      `UPDATE type::record('graph', $id) SET updated_at = $updated_at`,
      { id: node.graph_id, updated_at: Date.now() },
    );
  },

  async saveEdge(edge: GraphEdgeRecord): Promise<void> {
    const db = getDB();
    if (!db) return;
    const existing = await db.query<[GraphEdgeRecord[]]>(
      `SELECT id FROM type::record('graph_edge', $id) LIMIT 1`,
      { id: edge.id },
    );
    const exists = (existing[0]?.length ?? 0) > 0;

    if (exists) {
      await db.query(
        `UPDATE type::record('graph_edge', $id) SET
          graph_id = $graph_id,
          type = $type,
          source = $source,
          target = $target,
          label = $label,
          meta = $meta`,
        {
          id: edge.id,
          graph_id: edge.graph_id,
          type: edge.type ?? null,
          source: edge.source,
          target: edge.target,
          label: edge.label ?? null,
          meta: edge.meta ?? {},
        },
      );
    } else {
      await db.query(
        `CREATE graph_edge SET
          id = $id,
          graph_id = $graph_id,
          type = $type,
          source = $source,
          target = $target,
          label = $label,
          meta = $meta`,
        {
          id: edge.id,
          graph_id: edge.graph_id,
          type: edge.type ?? null,
          source: edge.source,
          target: edge.target,
          label: edge.label ?? null,
          meta: edge.meta ?? {},
        },
      );
    }
    await db.query(
      `UPDATE type::record('graph', $id) SET updated_at = $updated_at`,
      { id: edge.graph_id, updated_at: Date.now() },
    );
  },

  async deleteNode(graphId: string, nodeId: string): Promise<void> {
    const db = getDB();
    if (!db) return;
    // 删节点时同时删它的关联边（无论方向）
    await db.query(
      `DELETE graph_edge WHERE graph_id = $gid AND (source = $nid OR target = $nid)`,
      { gid: graphId, nid: nodeId },
    );
    await db.query(`DELETE type::record('graph_node', $id)`, { id: nodeId });
    await db.query(
      `UPDATE type::record('graph', $id) SET updated_at = $updated_at`,
      { id: graphId, updated_at: Date.now() },
    );
  },

  async deleteEdge(graphId: string, edgeId: string): Promise<void> {
    const db = getDB();
    if (!db) return;
    await db.query(`DELETE type::record('graph_edge', $id)`, { id: edgeId });
    await db.query(
      `UPDATE type::record('graph', $id) SET updated_at = $updated_at`,
      { id: graphId, updated_at: Date.now() },
    );
  },
};
