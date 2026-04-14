import { app } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Web 书签存储
 *
 * JSON 文件存储，复用 eBook 的文件夹组织模式。
 * Phase 1 用 JSON，Phase 2 迁移到 SurrealDB。
 */

// ── 数据模型 ──

export interface WebBookmark {
  id: string;
  title: string;
  url: string;
  favicon?: string;
  folderId: string | null;
  createdAt: number;
}

export interface WebBookmarkFolder {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  created_at: number;
}

interface BookmarkData {
  bookmarks: WebBookmark[];
  folders: WebBookmarkFolder[];
}

// ── 存储实现 ──

class BookmarkStore {
  private data: BookmarkData = { bookmarks: [], folders: [] };
  private loaded = false;

  private get dataDir(): string {
    return path.join(app.getPath('userData'), 'krig-note', 'web');
  }

  private get storePath(): string {
    return path.join(this.dataDir, 'bookmarks.json');
  }

  private ensureDir(): void {
    if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
  }

  private load(): void {
    if (this.loaded) return;
    this.ensureDir();
    if (existsSync(this.storePath)) {
      try {
        this.data = JSON.parse(readFileSync(this.storePath, 'utf-8'));
      } catch {
        this.data = { bookmarks: [], folders: [] };
      }
    }
    this.loaded = true;
  }

  private save(): void {
    this.ensureDir();
    writeFileSync(this.storePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  // ── 书签操作 ──

  list(): WebBookmark[] {
    this.load();
    return [...this.data.bookmarks].sort((a, b) => b.createdAt - a.createdAt);
  }

  add(url: string, title: string, favicon?: string): WebBookmark {
    this.load();
    const bookmark: WebBookmark = {
      id: randomUUID(),
      title,
      url,
      favicon,
      folderId: null,
      createdAt: Date.now(),
    };
    this.data.bookmarks.push(bookmark);
    this.save();
    return bookmark;
  }

  remove(id: string): void {
    this.load();
    this.data.bookmarks = this.data.bookmarks.filter((b) => b.id !== id);
    this.save();
  }

  update(id: string, fields: Partial<Pick<WebBookmark, 'title' | 'url' | 'favicon'>>): void {
    this.load();
    const bookmark = this.data.bookmarks.find((b) => b.id === id);
    if (bookmark) {
      Object.assign(bookmark, fields);
      this.save();
    }
  }

  move(id: string, folderId: string | null): void {
    this.load();
    const bookmark = this.data.bookmarks.find((b) => b.id === id);
    if (bookmark) {
      bookmark.folderId = folderId;
      this.save();
    }
  }

  findByUrl(url: string): WebBookmark | null {
    this.load();
    return this.data.bookmarks.find((b) => b.url === url) ?? null;
  }

  // ── 文件夹操作 ──

  folderList(): WebBookmarkFolder[] {
    this.load();
    return [...this.data.folders].sort((a, b) => a.sort_order - b.sort_order);
  }

  folderCreate(title: string, parentId?: string | null): WebBookmarkFolder {
    this.load();
    const siblings = this.data.folders.filter((f) => f.parent_id === (parentId ?? null));
    const folder: WebBookmarkFolder = {
      id: randomUUID(),
      title,
      parent_id: parentId ?? null,
      sort_order: siblings.length + 1,
      created_at: Date.now(),
    };
    this.data.folders.push(folder);
    this.save();
    return folder;
  }

  folderRename(id: string, title: string): void {
    this.load();
    const folder = this.data.folders.find((f) => f.id === id);
    if (folder) { folder.title = title; this.save(); }
  }

  folderDelete(id: string): void {
    this.load();
    // 递归删除子文件夹
    const children = this.data.folders.filter((f) => f.parent_id === id);
    for (const child of children) this.folderDelete(child.id);
    // 文件夹下的书签移到根目录
    for (const bookmark of this.data.bookmarks) {
      if (bookmark.folderId === id) bookmark.folderId = null;
    }
    this.data.folders = this.data.folders.filter((f) => f.id !== id);
    this.save();
  }
}

export const bookmarkStore = new BookmarkStore();
