import { app } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * eBook 标注存储
 *
 * 每本书一个 JSON 文件：{userData}/krig-note/ebook/annotations/{bookId}.json
 */

export interface StoredAnnotation {
  id: string;
  type: 'rect' | 'underline';
  color: string;
  pageNum: number;
  rect: { x: number; y: number; w: number; h: number };
  ocrText?: string;
  createdAt: number;
}

class AnnotationStore {
  private cache = new Map<string, StoredAnnotation[]>();

  private get dir(): string {
    return path.join(app.getPath('userData'), 'krig-note', 'ebook', 'annotations');
  }

  private filePath(bookId: string): string {
    return path.join(this.dir, `${bookId}.json`);
  }

  private ensureDir(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  private load(bookId: string): StoredAnnotation[] {
    const cached = this.cache.get(bookId);
    if (cached) return cached;

    this.ensureDir();
    const fp = this.filePath(bookId);
    if (!existsSync(fp)) {
      this.cache.set(bookId, []);
      return [];
    }

    try {
      const data = JSON.parse(readFileSync(fp, 'utf-8'));
      this.cache.set(bookId, data);
      return data;
    } catch {
      this.cache.set(bookId, []);
      return [];
    }
  }

  private save(bookId: string): void {
    this.ensureDir();
    const data = this.cache.get(bookId) ?? [];
    writeFileSync(this.filePath(bookId), JSON.stringify(data, null, 2), 'utf-8');
  }

  list(bookId: string): StoredAnnotation[] {
    return this.load(bookId);
  }

  add(bookId: string, ann: {
    type: 'rect' | 'underline';
    color: string;
    pageNum: number;
    rect: { x: number; y: number; w: number; h: number };
  }): StoredAnnotation {
    const annotations = this.load(bookId);
    const stored: StoredAnnotation = {
      id: randomUUID(),
      ...ann,
      createdAt: Date.now(),
    };
    annotations.push(stored);
    this.cache.set(bookId, annotations);
    this.save(bookId);
    return stored;
  }

  remove(bookId: string, annotationId: string): void {
    const annotations = this.load(bookId);
    const filtered = annotations.filter((a) => a.id !== annotationId);
    this.cache.set(bookId, filtered);
    this.save(bookId);
  }
}

export const annotationStore = new AnnotationStore();
