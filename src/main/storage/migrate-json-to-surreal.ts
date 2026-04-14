import { app } from 'electron';
import { readFileSync, existsSync, readdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { getDB } from './client';

/**
 * JSON → SurrealDB 一次性迁移
 *
 * 检测旧 JSON 文件是否存在，如果存在则导入到 SurrealDB，
 * 导入成功后将 JSON 文件重命名为 .migrated 备份。
 *
 * 幂等：只在 JSON 文件存在时执行，已迁移的不会重复导入。
 */

export async function migrateJsonToSurreal(): Promise<void> {
  const db = getDB();
  if (!db) {
    console.warn('[Migration] DB not ready, skipping');
    return;
  }

  console.log('[Migration] Checking for JSON data to migrate...');

  let migrated = 0;

  // ── eBook 书架 ──
  migrated += await migrateBookshelf(db);

  // ── eBook 标注 ──
  migrated += await migrateAnnotations(db);

  // ── Web 书签 ──
  migrated += await migrateBookmarks(db);

  // ── Web 历史 ──
  migrated += await migrateHistory(db);

  // ── Media 索引 ──
  migrated += await migrateMediaIndex(db);

  if (migrated > 0) {
    console.log(`[Migration] Completed: ${migrated} data sets migrated`);
  } else {
    console.log('[Migration] No JSON data to migrate');
  }
}

async function migrateBookshelf(db: any): Promise<number> {
  const filePath = path.join(app.getPath('userData'), 'krig-note', 'ebook', 'bookshelf.json');
  if (!existsSync(filePath)) return 0;

  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    const data = Array.isArray(raw)
      ? { entries: raw, folders: [] }
      : { entries: raw.entries ?? [], folders: raw.folders ?? [] };

    // 检查目标表是否已有数据（防止重复导入）
    const existing = await db.query(`SELECT count() AS count FROM ebook GROUP ALL`);
    if ((existing[0]?.[0]?.count ?? 0) > 0) {
      console.log('[Migration] ebook table already has data, skipping bookshelf');
      return 0;
    }

    // 导入 entries
    for (const e of data.entries) {
      // 处理旧格式字段迁移
      const lastPosition = e.lastPosition ?? (
        (e.lastPage !== undefined || e.lastScale !== undefined)
          ? { page: e.lastPage, scale: e.lastScale, fitWidth: e.lastFitWidth, cfi: e.lastCFI }
          : undefined
      );

      await db.query(
        `CREATE ebook SET id = $id, file_type = $file_type, storage = $storage, file_path = $file_path, original_path = $original_path, file_name = $file_name, display_name = $display_name, page_count = $page_count, folder_id = $folder_id, added_at = $added_at, last_opened_at = $last_opened_at, last_position = $last_position, bookmarks = $bookmarks, cfi_bookmarks = $cfi_bookmarks`,
        {
          id: e.id,
          file_type: e.fileType,
          storage: e.storage,
          file_path: e.filePath,
          original_path: e.originalPath ?? null,
          file_name: e.fileName,
          display_name: e.displayName,
          page_count: e.pageCount ?? null,
          folder_id: e.folderId ?? null,
          added_at: e.addedAt,
          last_opened_at: e.lastOpenedAt,
          last_position: lastPosition ?? null,
          bookmarks: e.bookmarks ?? null,
          cfi_bookmarks: e.cfiBookmarks ?? null,
        },
      );
    }

    // 导入 folders
    for (const f of data.folders) {
      await db.query(
        `CREATE ebook_folder SET id = $id, title = $title, parent_id = $parent_id, sort_order = $sort_order, created_at = $created_at`,
        { id: f.id, title: f.title, parent_id: f.parent_id, sort_order: f.sort_order, created_at: f.created_at },
      );
    }

    renameSync(filePath, filePath + '.migrated');
    console.log(`[Migration] Bookshelf: ${data.entries.length} entries, ${data.folders.length} folders`);
    return 1;
  } catch (err) {
    console.error('[Migration] Bookshelf migration failed:', err);
    return 0;
  }
}

async function migrateAnnotations(db: any): Promise<number> {
  const annDir = path.join(app.getPath('userData'), 'krig-note', 'ebook', 'annotations');
  if (!existsSync(annDir)) return 0;

  const files = readdirSync(annDir).filter((f) => f.endsWith('.json'));
  if (files.length === 0) return 0;

  // 检查目标表是否已有数据
  const existing = await db.query(`SELECT count() AS count FROM annotation GROUP ALL`);
  if ((existing[0]?.[0]?.count ?? 0) > 0) {
    console.log('[Migration] annotation table already has data, skipping');
    return 0;
  }

  let total = 0;
  for (const file of files) {
    const bookId = file.replace('.json', '');
    const filePath = path.join(annDir, file);
    try {
      const annotations = JSON.parse(readFileSync(filePath, 'utf-8'));
      for (const a of annotations) {
        await db.query(
          `CREATE annotation SET id = $id, book_id = $book_id, type = $type, color = $color, page_num = $page_num, rect = $rect, cfi = $cfi, text_content = $text_content, ocr_text = $ocr_text, created_at = $created_at`,
          {
            id: a.id,
            book_id: bookId,
            type: a.type,
            color: a.color,
            page_num: a.pageNum,
            rect: a.rect,
            cfi: a.cfi ?? null,
            text_content: a.textContent ?? null,
            ocr_text: a.ocrText ?? null,
            created_at: a.createdAt,
          },
        );
        total++;
      }
      renameSync(filePath, filePath + '.migrated');
    } catch (err) {
      console.error(`[Migration] Annotation ${file} failed:`, err);
    }
  }

  console.log(`[Migration] Annotations: ${total} records from ${files.length} files`);
  return total > 0 ? 1 : 0;
}

async function migrateBookmarks(db: any): Promise<number> {
  const filePath = path.join(app.getPath('userData'), 'krig-note', 'web', 'bookmarks.json');
  if (!existsSync(filePath)) return 0;

  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    const bookmarks = data.bookmarks ?? [];
    const folders = data.folders ?? [];

    const existing = await db.query(`SELECT count() AS count FROM bookmark GROUP ALL`);
    if ((existing[0]?.[0]?.count ?? 0) > 0) {
      console.log('[Migration] bookmark table already has data, skipping');
      return 0;
    }

    for (const b of bookmarks) {
      await db.query(
        `CREATE bookmark SET id = $id, url = $url, title = $title, favicon = $favicon, folder_id = $folder_id, created_at = $created_at`,
        {
          id: b.id, url: b.url, title: b.title,
          favicon: b.favicon ?? null, folder_id: b.folderId ?? null,
          created_at: b.createdAt,
        },
      );
    }

    for (const f of folders) {
      await db.query(
        `CREATE bookmark_folder SET id = $id, title = $title, parent_id = $parent_id, sort_order = $sort_order, created_at = $created_at`,
        { id: f.id, title: f.title, parent_id: f.parent_id, sort_order: f.sort_order, created_at: f.created_at },
      );
    }

    renameSync(filePath, filePath + '.migrated');
    console.log(`[Migration] Bookmarks: ${bookmarks.length} bookmarks, ${folders.length} folders`);
    return 1;
  } catch (err) {
    console.error('[Migration] Bookmark migration failed:', err);
    return 0;
  }
}

async function migrateHistory(db: any): Promise<number> {
  const filePath = path.join(app.getPath('userData'), 'krig-note', 'web', 'history.json');
  if (!existsSync(filePath)) return 0;

  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    if (!Array.isArray(data) || data.length === 0) return 0;

    const existing = await db.query(`SELECT count() AS count FROM web_history GROUP ALL`);
    if ((existing[0]?.[0]?.count ?? 0) > 0) {
      console.log('[Migration] web_history table already has data, skipping');
      return 0;
    }

    for (const h of data) {
      await db.query(
        `CREATE web_history SET id = $id, url = $url, title = $title, favicon = $favicon, visited_at = $visited_at`,
        {
          id: h.id, url: h.url, title: h.title,
          favicon: h.favicon ?? null, visited_at: h.visitedAt,
        },
      );
    }

    renameSync(filePath, filePath + '.migrated');
    console.log(`[Migration] History: ${data.length} entries`);
    return 1;
  } catch (err) {
    console.error('[Migration] History migration failed:', err);
    return 0;
  }
}

async function migrateMediaIndex(db: any): Promise<number> {
  const filePath = path.join(app.getPath('userData'), 'krig-data', 'media', 'media-index.json');
  if (!existsSync(filePath)) return 0;

  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    const entries = data.entries ?? {};
    const urls = Object.keys(entries);
    if (urls.length === 0) return 0;

    const existing = await db.query(`SELECT count() AS count FROM media GROUP ALL`);
    if ((existing[0]?.[0]?.count ?? 0) > 0) {
      console.log('[Migration] media table already has data, skipping');
      return 0;
    }

    for (const url of urls) {
      const e = entries[url];
      await db.query(
        `CREATE media SET id = $id, original_url = $original_url, local_path = $local_path, size = $size, mime_type = $mime_type, created_at = $created_at`,
        {
          id: e.mediaId,
          original_url: e.originalUrl,
          local_path: e.localPath,
          size: e.size,
          mime_type: e.mimeType,
          created_at: e.createdAt,
        },
      );
    }

    renameSync(filePath, filePath + '.migrated');
    console.log(`[Migration] Media: ${urls.length} entries`);
    return 1;
  } catch (err) {
    console.error('[Migration] Media migration failed:', err);
    return 0;
  }
}
