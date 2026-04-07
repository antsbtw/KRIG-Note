import { app } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, unlinkSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * eBook 书架存储
 *
 * JSON 文件存储，管理用户导入的电子书条目和文件夹。
 * Phase 1 用 JSON，Phase 2 迁移到 SurrealDB。
 */

// ── 数据模型 ──

export interface EBookEntry {
  id: string;
  fileType: 'pdf' | 'epub' | 'djvu' | 'cbz';
  storage: 'link' | 'managed';
  filePath: string;
  originalPath?: string;
  fileName: string;
  displayName: string;
  pageCount?: number;
  folderId: string | null;
  addedAt: number;
  lastOpenedAt: number;
  lastPage?: number;
  lastScale?: number;
  lastFitWidth?: boolean;
}

export interface EBookFolder {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  created_at: number;
}

interface BookshelfData {
  entries: EBookEntry[];
  folders: EBookFolder[];
}

// ── 存储实现 ──

class BookshelfStore {
  private data: BookshelfData = { entries: [], folders: [] };
  private loaded = false;

  private get dataDir(): string {
    return path.join(app.getPath('userData'), 'krig-note', 'ebook');
  }

  private get libraryDir(): string {
    return path.join(this.dataDir, 'library');
  }

  private get storePath(): string {
    return path.join(this.dataDir, 'bookshelf.json');
  }

  private ensureDir(): void {
    if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
    if (!existsSync(this.libraryDir)) mkdirSync(this.libraryDir, { recursive: true });
  }

  private load(): void {
    if (this.loaded) return;
    this.ensureDir();
    if (existsSync(this.storePath)) {
      try {
        const raw = JSON.parse(readFileSync(this.storePath, 'utf-8'));
        // 兼容旧格式（纯数组 → 新格式）
        if (Array.isArray(raw)) {
          this.data = { entries: raw.map((e: any) => ({ ...e, folderId: e.folderId ?? null })), folders: [] };
        } else {
          this.data = { entries: raw.entries ?? [], folders: raw.folders ?? [] };
        }
      } catch {
        this.data = { entries: [], folders: [] };
      }
    }
    this.loaded = true;
  }

  private save(): void {
    this.ensureDir();
    writeFileSync(this.storePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  // ── 书本操作 ──

  list(): EBookEntry[] {
    this.load();
    return [...this.data.entries].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  }

  get(id: string): EBookEntry | null {
    this.load();
    return this.data.entries.find((e) => e.id === id) ?? null;
  }

  addManaged(srcPath: string, fileType: EBookEntry['fileType'], pageCount?: number): EBookEntry {
    this.load();

    const id = randomUUID();
    const ext = path.extname(srcPath);
    const destPath = path.join(this.libraryDir, `${id}${ext}`);
    copyFileSync(srcPath, destPath);

    const entry: EBookEntry = {
      id, fileType, storage: 'managed',
      filePath: destPath, originalPath: srcPath,
      fileName: path.basename(srcPath),
      displayName: path.basename(srcPath, ext),
      pageCount, folderId: null,
      addedAt: Date.now(), lastOpenedAt: Date.now(),
    };

    this.data.entries.push(entry);
    this.save();
    return entry;
  }

  addLinked(srcPath: string, fileType: EBookEntry['fileType'], pageCount?: number): EBookEntry {
    this.load();

    const ext = path.extname(srcPath);
    const entry: EBookEntry = {
      id: randomUUID(), fileType, storage: 'link',
      filePath: srcPath,
      fileName: path.basename(srcPath),
      displayName: path.basename(srcPath, ext),
      pageCount, folderId: null,
      addedAt: Date.now(), lastOpenedAt: Date.now(),
    };

    this.data.entries.push(entry);
    this.save();
    return entry;
  }

  remove(id: string): void {
    this.load();
    const entry = this.data.entries.find((e) => e.id === id);
    if (!entry) return;

    if (entry.storage === 'managed' && existsSync(entry.filePath)) {
      try { unlinkSync(entry.filePath); } catch { /* ignore */ }
    }

    this.data.entries = this.data.entries.filter((e) => e.id !== id);
    this.save();
  }

  rename(id: string, displayName: string): void {
    this.load();
    const entry = this.data.entries.find((e) => e.id === id);
    if (entry) { entry.displayName = displayName; this.save(); }
  }

  moveToFolder(id: string, folderId: string | null): void {
    this.load();
    const entry = this.data.entries.find((e) => e.id === id);
    if (entry) { entry.folderId = folderId; this.save(); }
  }

  updateOpened(id: string): void {
    this.load();
    const entry = this.data.entries.find((e) => e.id === id);
    if (entry) { entry.lastOpenedAt = Date.now(); this.save(); }
  }

  updateProgress(id: string, lastPage: number, lastScale?: number, lastFitWidth?: boolean): void {
    this.load();
    const entry = this.data.entries.find((e) => e.id === id);
    if (entry) {
      entry.lastPage = lastPage;
      if (lastScale !== undefined) entry.lastScale = lastScale;
      if (lastFitWidth !== undefined) entry.lastFitWidth = lastFitWidth;
      this.save();
    }
  }

  async checkExists(id: string): Promise<boolean> {
    this.load();
    const entry = this.data.entries.find((e) => e.id === id);
    if (!entry) return false;
    try { await stat(entry.filePath); return true; } catch { return false; }
  }

  // ── 文件夹操作 ──

  folderList(): EBookFolder[] {
    this.load();
    return [...this.data.folders].sort((a, b) => a.sort_order - b.sort_order);
  }

  folderCreate(title: string, parentId?: string | null): EBookFolder {
    this.load();
    const siblings = this.data.folders.filter((f) => f.parent_id === (parentId ?? null));
    const folder: EBookFolder = {
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
    const childFolders = this.data.folders.filter((f) => f.parent_id === id);
    for (const child of childFolders) {
      this.folderDelete(child.id);
    }

    // 该文件夹下的书本移到根目录
    for (const entry of this.data.entries) {
      if (entry.folderId === id) entry.folderId = null;
    }

    this.data.folders = this.data.folders.filter((f) => f.id !== id);
    this.save();
  }

  folderMove(id: string, parentId: string | null): void {
    this.load();
    const folder = this.data.folders.find((f) => f.id === id);
    if (folder) { folder.parent_id = parentId; this.save(); }
  }
}

export const bookshelfStore = new BookshelfStore();
