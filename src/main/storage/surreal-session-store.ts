import { getDB } from './client';
import type { ISessionStore, SessionData } from './types';

/**
 * SessionStore — 状态记录（SurrealDB 版）
 *
 * 替代之前的 session.json 文件。
 * 只有一条记录（id = 'current'）。
 */

export const surrealSessionStore: ISessionStore = {
  async save(session: SessionData): Promise<void> {
    const db = getDB();
    if (!db) return;

    const now = Date.now();
    await db.query(
      `UPSERT session SET id = 'current', workspaces = $workspaces, active_workspace_id = $activeId, nav_side_width = $navSideWidth, updated_at = $updatedAt`,
      {
        workspaces: session.workspaces,
        activeId: session.activeWorkspaceId,
        navSideWidth: session.navSideWidth,
        updatedAt: now,
      },
    );
  },

  async load(): Promise<SessionData | null> {
    const db = getDB();
    if (!db) return null;

    const result = await db.query<[Record<string, unknown>[]]>(
      `SELECT * FROM session WHERE id = 'current' LIMIT 1`,
    );

    const records = result[0];
    if (!records || records.length === 0) return null;

    const r = records[0];
    return {
      workspaces: (r.workspaces as SessionData['workspaces']) || [],
      activeWorkspaceId: (r.active_workspace_id as string) || null,
      navSideWidth: (r.nav_side_width as number) || 240,
    };
  },
};
