import { getDB } from './client';

/**
 * Schema 初始化 — 3 个表（Phase 1）
 *
 * note:     NoteFile 存储
 * activity: 操作记录
 * session:  状态记录
 */

const SCHEMA_QUERIES = [
  // note 表（SCHEMALESS — 避免嵌套 JSON 类型冲突）
  `DEFINE TABLE IF NOT EXISTS note SCHEMALESS;`,
  `DEFINE INDEX IF NOT EXISTS note_title ON note FIELDS title;`,
  `DEFINE INDEX IF NOT EXISTS note_updated ON note FIELDS updated_at;`,

  // activity 表（操作记录）
  `DEFINE TABLE IF NOT EXISTS activity SCHEMALESS;`,
  `DEFINE INDEX IF NOT EXISTS activity_time ON activity FIELDS timestamp;`,
  `DEFINE INDEX IF NOT EXISTS activity_action ON activity FIELDS action;`,

  // session 表（状态记录）
  `DEFINE TABLE IF NOT EXISTS session SCHEMALESS;`,
];

export async function initSchema(): Promise<void> {
  const db = getDB();
  if (!db) {
    console.error('[Schema] DB not connected');
    return;
  }

  console.log('[Schema] Initializing...');

  for (const query of SCHEMA_QUERIES) {
    try {
      await db.query(query);
    } catch (err) {
      console.error(`[Schema] Failed: ${query}`, err);
    }
  }

  console.log(`[Schema] Initialized (${SCHEMA_QUERIES.length} queries)`);
}
