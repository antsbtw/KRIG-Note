import { app } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Web 浏览历史存储
 *
 * JSON 文件存储，自动记录浏览的 URL。
 * 最多保留 500 条记录，超过时自动清理最旧的。
 */

export interface WebHistoryEntry {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  visitedAt: number;
}

const MAX_ENTRIES = 500;

class HistoryStore {
  private data: WebHistoryEntry[] = [];
  private loaded = false;

  private get dataDir(): string {
    return path.join(app.getPath('userData'), 'krig-note', 'web');
  }

  private get storePath(): string {
    return path.join(this.dataDir, 'history.json');
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
        this.data = [];
      }
    }
    this.loaded = true;
  }

  private save(): void {
    this.ensureDir();
    writeFileSync(this.storePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  add(url: string, title: string, favicon?: string): WebHistoryEntry {
    this.load();
    const entry: WebHistoryEntry = {
      id: randomUUID(),
      url,
      title,
      favicon,
      visitedAt: Date.now(),
    };
    this.data.unshift(entry);
    // 超过上限时清理
    if (this.data.length > MAX_ENTRIES) {
      this.data = this.data.slice(0, MAX_ENTRIES);
    }
    this.save();
    return entry;
  }

  list(limit = 50): WebHistoryEntry[] {
    this.load();
    return this.data.slice(0, limit);
  }

  clear(): void {
    this.data = [];
    this.loaded = true;
    this.save();
  }
}

export const historyStore = new HistoryStore();
