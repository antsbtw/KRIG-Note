import { getDB } from '../storage/client';

/**
 * Graph Store — SurrealDB RELATE 关系管理
 *
 * 管理实体间的 Graph 关系：
 * - sourced_from: note → ebook（笔记来源于某本书）
 * - clipped_from: note → bookmark（笔记来源于某个网页）
 * - links_to:     note → note（笔记间链接引用）
 *
 * 注意：RELATE 语句不支持 type::record()，需要用 record ID 字面量。
 * 使用 SurrealQL 的 <record> cast 语法：<record> $var
 */

// ── 关系边属性类型 ──

export interface SourcedFromEdge {
  extraction_type: 'pdf' | 'epub';
  page_start?: number;
  page_end?: number;
  chapter_title?: string;
  created_at: number;
}

export interface ClippedFromEdge {
  url: string;
  page_title?: string;
  created_at: number;
}

export interface LinksToEdge {
  created_at: number;
}

// ── 关联发现结果 ──

export interface RelatedItem {
  id: string;
  title: string;
  relevance: 'exact' | 'range' | 'loose';
  pageStart?: number;
  pageEnd?: number;
}

/** 构造 SurrealDB record ID 字符串：table:⟨id⟩ */
function rid(table: string, id: string): string {
  return `${table}:⟨${id}⟩`;
}

export const graphStore = {
  // ── 创建关系 ──

  /** note → ebook：笔记来源于某本书 */
  async relateNoteToEBook(
    noteId: string,
    ebookId: string,
    edge: SourcedFromEdge,
  ): Promise<void> {
    const db = getDB();
    if (!db) return;

    // RELATE 不支持 type::record()，直接拼 record literal
    const query = `RELATE ${rid('note', noteId)} -> sourced_from -> ${rid('ebook', ebookId)} SET extraction_type = $extraction_type, page_start = $page_start, page_end = $page_end, chapter_title = $chapter_title, created_at = $created_at`;
    await db.query(query, {
      extraction_type: edge.extraction_type,
      page_start: edge.page_start ?? null,
      page_end: edge.page_end ?? null,
      chapter_title: edge.chapter_title ?? null,
      created_at: edge.created_at,
    });
  },

  /** note → bookmark：笔记来源于某个网页 */
  async relateNoteToBookmark(
    noteId: string,
    bookmarkId: string,
    edge: ClippedFromEdge,
  ): Promise<void> {
    const db = getDB();
    if (!db) return;

    const query = `RELATE ${rid('note', noteId)} -> clipped_from -> ${rid('bookmark', bookmarkId)} SET url = $url, page_title = $page_title, created_at = $created_at`;
    await db.query(query, {
      url: edge.url,
      page_title: edge.page_title ?? null,
      created_at: edge.created_at,
    });
  },

  /** note → note：笔记间链接 */
  async relateNoteToNote(
    fromNoteId: string,
    toNoteId: string,
  ): Promise<void> {
    const db = getDB();
    if (!db) return;

    const query = `RELATE ${rid('note', fromNoteId)} -> links_to -> ${rid('note', toNoteId)} SET created_at = $created_at`;
    await db.query(query, { created_at: Date.now() });
  },

  // ── 删除关系 ──

  async removeNoteToNote(fromNoteId: string, toNoteId: string): Promise<void> {
    const db = getDB();
    if (!db) return;

    await db.query(
      `DELETE FROM links_to WHERE in = ${rid('note', fromNoteId)} AND out = ${rid('note', toNoteId)}`,
    );
  },

  // ── 关联发现查询 ──

  /** 某本书关联的所有笔记 */
  async findNotesForEBook(ebookId: string, currentPage?: number): Promise<RelatedItem[]> {
    const db = getDB();
    if (!db) return [];

    const result = await db.query<[any[]]>(
      `SELECT in.id AS note_id, in.title AS title, page_start, page_end, chapter_title FROM sourced_from WHERE out = ${rid('ebook', ebookId)}`,
    );

    const edges = result[0] || [];
    return edges.map((e) => {
      let relevance: 'exact' | 'range' | 'loose' = 'loose';
      if (currentPage != null && e.page_start != null && e.page_end != null) {
        if (currentPage >= e.page_start && currentPage <= e.page_end) {
          relevance = 'exact';
        } else {
          relevance = 'range';
        }
      }
      return {
        id: cleanNoteId(e.note_id),
        title: e.title || e.chapter_title || '',
        relevance,
        pageStart: e.page_start,
        pageEnd: e.page_end,
      };
    }).sort((a, b) => {
      const order = { exact: 0, range: 1, loose: 2 };
      return order[a.relevance] - order[b.relevance];
    });
  },

  /** 某篇笔记的来源书籍 */
  async findEBooksForNote(noteId: string): Promise<Array<{ id: string; title: string }>> {
    const db = getDB();
    if (!db) return [];

    const result = await db.query<[any[]]>(
      `SELECT out.id AS ebook_id, out.display_name AS title FROM sourced_from WHERE in = ${rid('note', noteId)}`,
    );

    return (result[0] || []).map((e) => ({
      id: cleanEBookId(e.ebook_id),
      title: e.title || '',
    }));
  },

  /** 某篇笔记的来源网页 */
  async findBookmarksForNote(noteId: string): Promise<Array<{ id: string; url: string; title: string }>> {
    const db = getDB();
    if (!db) return [];

    const result = await db.query<[any[]]>(
      `SELECT out.id AS bookmark_id, url, page_title FROM clipped_from WHERE in = ${rid('note', noteId)}`,
    );

    return (result[0] || []).map((e) => ({
      id: cleanBookmarkId(e.bookmark_id),
      url: e.url || '',
      title: e.page_title || '',
    }));
  },

  /** 某篇笔记链接到的其他笔记 */
  async findLinkedNotes(noteId: string): Promise<Array<{ id: string; title: string }>> {
    const db = getDB();
    if (!db) return [];

    const result = await db.query<[any[]]>(
      `SELECT out.id AS note_id, out.title AS title FROM links_to WHERE in = ${rid('note', noteId)}`,
    );

    return (result[0] || []).map((e) => ({
      id: cleanNoteId(e.note_id),
      title: e.title || '',
    }));
  },

  /** 某个 URL 关联的所有笔记 */
  async findNotesForUrl(url: string): Promise<Array<{ id: string; title: string }>> {
    const db = getDB();
    if (!db) return [];

    const result = await db.query<[any[]]>(
      `SELECT in.id AS note_id, in.title AS title FROM clipped_from WHERE url = $url`,
      { url },
    );

    return (result[0] || []).map((e) => ({
      id: cleanNoteId(e.note_id),
      title: e.title || '',
    }));
  },

  // ── Thought 关系 ──

  /** note → thought：笔记的思考 */
  async relateNoteToThought(
    noteId: string,
    thoughtId: string,
    edge: { anchor_type: string; anchor_pos: number; created_at: number },
  ): Promise<void> {
    const db = getDB();
    if (!db) return;

    const query = `RELATE ${rid('note', noteId)} -> thought_of -> ${rid('thought', thoughtId)} SET anchor_type = $anchor_type, anchor_pos = $anchor_pos, created_at = $created_at`;
    await db.query(query, {
      anchor_type: edge.anchor_type,
      anchor_pos: edge.anchor_pos,
      created_at: edge.created_at,
    });
  },

  /** 删除 note → thought 关系 */
  async removeNoteToThought(noteId: string, thoughtId: string): Promise<void> {
    const db = getDB();
    if (!db) return;

    await db.query(
      `DELETE FROM thought_of WHERE in = ${rid('note', noteId)} AND out = ${rid('thought', thoughtId)}`,
    );
  },

  /** 某 Thought 属于哪篇笔记 */
  async findNoteForThought(thoughtId: string): Promise<{ id: string; title: string } | null> {
    const db = getDB();
    if (!db) return null;

    const result = await db.query<[any[]]>(
      `SELECT in.id AS note_id, in.title AS title FROM thought_of WHERE out = ${rid('thought', thoughtId)} LIMIT 1`,
    );

    const edges = result[0] || [];
    if (edges.length === 0) return null;

    return {
      id: cleanNoteId(edges[0].note_id),
      title: edges[0].title || '',
    };
  },
};

function cleanThoughtId(raw: unknown): string {
  return String(raw).replace(/^thought:⟨?|⟩?$/g, '');
}

function cleanNoteId(raw: unknown): string {
  return String(raw).replace(/^note:⟨?|⟩?$/g, '');
}

function cleanEBookId(raw: unknown): string {
  return String(raw).replace(/^ebook:⟨?|⟩?$/g, '');
}

function cleanBookmarkId(raw: unknown): string {
  return String(raw).replace(/^bookmark:⟨?|⟩?$/g, '');
}
