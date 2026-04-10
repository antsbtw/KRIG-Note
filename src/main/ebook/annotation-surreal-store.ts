import { getDB } from '../storage/client';

/**
 * eBook 标注存储 — SurrealDB 版本
 *
 * 替代原 JSON 文件 annotation-store.ts（每本书一个 JSON 文件）。
 * 表：annotation（统一存储，book_id 字段区分所属书籍）
 */

export interface StoredAnnotation {
  id: string;
  type: 'rect' | 'underline';
  color: string;
  pageNum: number;
  rect: { x: number; y: number; w: number; h: number };
  cfi?: string;
  textContent?: string;
  ocrText?: string;
  createdAt: number;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanRecordId(raw: unknown): string {
  return String(raw).replace(/^annotation:⟨?|⟩?$/g, '');
}

export const annotationSurrealStore = {
  async list(bookId: string): Promise<StoredAnnotation[]> {
    const db = getDB();
    if (!db) return [];

    const result = await db.query<[any[]]>(
      `SELECT * FROM annotation WHERE book_id = $book_id ORDER BY page_num ASC, created_at ASC`,
      { book_id: bookId },
    );

    return (result[0] || []).map(mapAnnotationRecord);
  },

  async add(bookId: string, ann: {
    type: 'rect' | 'underline';
    color: string;
    pageNum: number;
    rect: { x: number; y: number; w: number; h: number };
    cfi?: string;
    textContent?: string;
  }): Promise<StoredAnnotation> {
    const db = getDB();
    if (!db) throw new Error('DB not ready');

    const id = generateId();
    const now = Date.now();

    await db.query(
      `CREATE annotation SET id = $id, book_id = $book_id, type = $type, color = $color, page_num = $page_num, rect = $rect, cfi = $cfi, text_content = $text_content, created_at = $created_at`,
      {
        id, book_id: bookId,
        type: ann.type, color: ann.color,
        page_num: ann.pageNum, rect: ann.rect,
        cfi: ann.cfi ?? null, text_content: ann.textContent ?? null,
        created_at: now,
      },
    );

    return {
      id,
      type: ann.type,
      color: ann.color,
      pageNum: ann.pageNum,
      rect: ann.rect,
      cfi: ann.cfi,
      textContent: ann.textContent,
      createdAt: now,
    };
  },

  async remove(bookId: string, annotationId: string): Promise<void> {
    const db = getDB();
    if (!db) return;

    await db.query(
      `DELETE type::record('annotation', $id)`,
      { id: annotationId },
    );
  },
};

function mapAnnotationRecord(r: any): StoredAnnotation {
  return {
    id: cleanRecordId(r.id),
    type: r.type,
    color: r.color,
    pageNum: r.page_num,
    rect: r.rect,
    cfi: r.cfi ?? undefined,
    textContent: r.text_content ?? undefined,
    ocrText: r.ocr_text ?? undefined,
    createdAt: r.created_at || 0,
  };
}
