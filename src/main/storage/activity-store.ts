import { getDB } from './client';
import type { IActivityStore, ActivityRecord } from './types';

/**
 * ActivityStore — 操作记录
 */

export const activityStore: IActivityStore = {
  async log(action: string, target?: string, metadata?: Record<string, unknown>): Promise<void> {
    const db = getDB();
    if (!db) return;

    const now = Date.now();
    await db.query(
      `CREATE activity SET timestamp = $timestamp, action = $action, target = $target, metadata = $metadata`,
      { timestamp: now, action, target: target || null, metadata: metadata || null },
    );
  },

  async getRecent(limit: number = 20): Promise<ActivityRecord[]> {
    const db = getDB();
    if (!db) return [];

    const result = await db.query<[ActivityRecord[]]>(
      `SELECT * FROM activity ORDER BY timestamp DESC LIMIT $limit`,
      { limit },
    );

    return (result[0] || []).map((r) => ({
      id: String(r.id),
      timestamp: r.timestamp || 0,
      action: r.action || '',
      target: r.target,
      metadata: r.metadata,
    }));
  },
};
