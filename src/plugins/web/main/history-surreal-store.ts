import { getDB } from '../../../main/storage/client';

/**
 * Web 浏览历史存储 — SurrealDB 版本
 *
 * 替代原 JSON 文件 history-store.ts。
 * 表：web_history
 * 保留最多 500 条记录的限制。
 */

export interface WebHistoryEntry {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  visitedAt: number;
}

const MAX_ENTRIES = 500;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanRecordId(raw: unknown): string {
  return String(raw).replace(/^web_history:⟨?|⟩?$/g, '');
}

export const historySurrealStore = {
  async add(url: string, title: string, favicon?: string): Promise<WebHistoryEntry> {
    const db = getDB();
    if (!db) throw new Error('DB not ready');

    const id = generateId();
    const now = Date.now();

    await db.query(
      `CREATE web_history SET id = $id, url = $url, title = $title, favicon = $favicon, visited_at = $visited_at`,
      { id, url, title, favicon: favicon ?? null, visited_at: now },
    );

    // 超过上限时清理最旧的
    const countResult = await db.query<[{ count: number }[]]>(
      `SELECT count() AS count FROM web_history GROUP ALL`,
    );
    const total = countResult[0]?.[0]?.count ?? 0;
    if (total > MAX_ENTRIES) {
      const excess = total - MAX_ENTRIES;
      await db.query(
        `DELETE FROM web_history ORDER BY visited_at ASC LIMIT $limit`,
        { limit: excess },
      );
    }

    return { id, url, title, favicon, visitedAt: now };
  },

  async list(limit = 50): Promise<WebHistoryEntry[]> {
    const db = getDB();
    if (!db) return [];

    const result = await db.query<[any[]]>(
      `SELECT * FROM web_history ORDER BY visited_at DESC LIMIT $limit`,
      { limit },
    );

    return (result[0] || []).map((r) => ({
      id: cleanRecordId(r.id),
      url: r.url || '',
      title: r.title || '',
      favicon: r.favicon ?? undefined,
      visitedAt: r.visited_at || 0,
    }));
  },

  async clear(): Promise<void> {
    const db = getDB();
    if (!db) return;
    await db.query(`DELETE FROM web_history`);
  },
};
