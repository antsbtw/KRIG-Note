import { getDB } from './client';

/**
 * Schema 初始化
 *
 * 业务数据（全部入库）：
 *   note, folder, vocab, activity
 *   ebook, ebook_folder, annotation
 *   bookmark, bookmark_folder, web_history
 *   media
 *
 * Graph 关系边：
 *   sourced_from (note → ebook)
 *   clipped_from (note → bookmark)
 *   links_to     (note → note)
 *
 * 运行时状态（保持现状）：
 *   session
 */

const SCHEMA_QUERIES = [
  // ── 已有表 ──

  // note 表（SCHEMALESS — 避免嵌套 JSON 类型冲突）
  `DEFINE TABLE IF NOT EXISTS note SCHEMALESS;`,
  `DEFINE INDEX IF NOT EXISTS note_title ON note FIELDS title;`,
  `DEFINE INDEX IF NOT EXISTS note_updated ON note FIELDS updated_at;`,
  `DEFINE INDEX IF NOT EXISTS note_folder ON note FIELDS folder_id;`,

  // folder 表（笔记文件夹）
  `DEFINE TABLE IF NOT EXISTS folder SCHEMALESS;`,
  `DEFINE INDEX IF NOT EXISTS folder_parent ON folder FIELDS parent_id;`,
  `DEFINE INDEX IF NOT EXISTS folder_sort ON folder FIELDS sort_order;`,

  // activity 表（操作记录）
  `DEFINE TABLE IF NOT EXISTS activity SCHEMALESS;`,
  `DEFINE INDEX IF NOT EXISTS activity_time ON activity FIELDS timestamp;`,
  `DEFINE INDEX IF NOT EXISTS activity_action ON activity FIELDS action;`,

  // session 表（运行时状态）
  `DEFINE TABLE IF NOT EXISTS session SCHEMALESS;`,

  // vocab 表（生词本）
  `DEFINE TABLE IF NOT EXISTS vocab SCHEMALESS;`,
  `DEFINE INDEX IF NOT EXISTS vocab_word ON vocab FIELDS word UNIQUE;`,
  `DEFINE INDEX IF NOT EXISTS vocab_created ON vocab FIELDS created_at;`,

  // ── P0 新增：业务数据入库 ──

  // ebook 表（电子书）
  `DEFINE TABLE IF NOT EXISTS ebook SCHEMALESS;`,
  `DEFINE INDEX IF NOT EXISTS ebook_folder ON ebook FIELDS folder_id;`,
  `DEFINE INDEX IF NOT EXISTS ebook_opened ON ebook FIELDS last_opened_at;`,

  // ebook_folder 表（电子书文件夹）
  `DEFINE TABLE IF NOT EXISTS ebook_folder SCHEMALESS;`,
  `DEFINE INDEX IF NOT EXISTS ebook_folder_parent ON ebook_folder FIELDS parent_id;`,
  `DEFINE INDEX IF NOT EXISTS ebook_folder_sort ON ebook_folder FIELDS sort_order;`,

  // annotation 表（电子书标注）
  `DEFINE TABLE IF NOT EXISTS annotation SCHEMALESS;`,
  `DEFINE INDEX IF NOT EXISTS annotation_book ON annotation FIELDS book_id;`,
  `DEFINE INDEX IF NOT EXISTS annotation_book_page ON annotation FIELDS book_id, page_num;`,

  // bookmark 表（网页书签）
  `DEFINE TABLE IF NOT EXISTS bookmark SCHEMALESS;`,
  `DEFINE INDEX IF NOT EXISTS bookmark_url ON bookmark FIELDS url;`,
  `DEFINE INDEX IF NOT EXISTS bookmark_folder ON bookmark FIELDS folder_id;`,

  // bookmark_folder 表（书签文件夹）
  `DEFINE TABLE IF NOT EXISTS bookmark_folder SCHEMALESS;`,
  `DEFINE INDEX IF NOT EXISTS bookmark_folder_parent ON bookmark_folder FIELDS parent_id;`,
  `DEFINE INDEX IF NOT EXISTS bookmark_folder_sort ON bookmark_folder FIELDS sort_order;`,

  // web_history 表（浏览历史）
  `DEFINE TABLE IF NOT EXISTS web_history SCHEMALESS;`,
  `DEFINE INDEX IF NOT EXISTS history_visited ON web_history FIELDS visited_at;`,
  `DEFINE INDEX IF NOT EXISTS history_url ON web_history FIELDS url;`,

  // media 表（媒体资源索引）
  `DEFINE TABLE IF NOT EXISTS media SCHEMALESS;`,
  `DEFINE INDEX IF NOT EXISTS media_url ON media FIELDS original_url;`,

  // ── Graph 关系边表 ──

  // note → ebook：笔记来源于某本书
  `DEFINE TABLE IF NOT EXISTS sourced_from SCHEMALESS;`,
  // 边属性：extraction_type, page_start, page_end, chapter_title, created_at

  // note → bookmark：笔记来源于某个网页
  `DEFINE TABLE IF NOT EXISTS clipped_from SCHEMALESS;`,
  // 边属性：url, page_title, created_at

  // note → note：笔记间链接引用
  `DEFINE TABLE IF NOT EXISTS links_to SCHEMALESS;`,
  // 边属性：created_at
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
