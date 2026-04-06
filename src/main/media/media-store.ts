/**
 * MediaStore — 本地媒体文件存储
 *
 * 功能：
 * - 下载远程媒体（audio/video/image）到本地
 * - SHA256 去重
 * - media:// 自定义协议注册
 * - media-index.json 索引管理
 *
 * 存储结构：
 * {userData}/krig-data/media/
 * ├── images/   → img-{hash16}.{ext}
 * ├── audio/    → audio-{hash16}.{ext}
 * └── media-index.json
 */

import { app, protocol, net } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

// ── 常量 ──

const MEDIA_DIR = path.join(app.getPath('userData'), 'krig-data', 'media');
const INDEX_FILE = path.join(MEDIA_DIR, 'media-index.json');

const SIZE_LIMITS: Record<string, number> = {
  audio: 50 * 1024 * 1024,   // 50MB
  video: 200 * 1024 * 1024,  // 200MB
  image: 20 * 1024 * 1024,   // 20MB
};

const MIME_TO_EXT: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/mp4': 'm4a',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

// ── 索引类型 ──

interface MediaIndexEntry {
  mediaId: string;
  originalUrl: string;
  localPath: string;
  size: number;
  mimeType: string;
  createdAt: number;
}

interface MediaIndex {
  version: number;
  entries: Record<string, MediaIndexEntry>;
}

// ── MediaStore ──

class LocalMediaStore {
  private index: MediaIndex = { version: 1, entries: {} };

  constructor() {
    this.ensureDirs();
    this.loadIndex();
  }

  private ensureDirs(): void {
    for (const sub of ['images', 'audio']) {
      fs.mkdirSync(path.join(MEDIA_DIR, sub), { recursive: true });
    }
  }

  private loadIndex(): void {
    try {
      if (fs.existsSync(INDEX_FILE)) {
        this.index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));
      }
    } catch {
      this.index = { version: 1, entries: {} };
    }
  }

  private saveIndex(): void {
    fs.writeFileSync(INDEX_FILE, JSON.stringify(this.index, null, 2));
  }

  /** 注册 media:// 协议 */
  registerProtocol(): void {
    protocol.handle('media', (request) => {
      const urlPath = request.url.replace('media://', '');
      const filePath = path.join(MEDIA_DIR, urlPath);
      return net.fetch(`file://${filePath}`);
    });
  }

  /** 下载远程媒体到本地 */
  async download(url: string, mediaType: 'audio' | 'image'): Promise<{
    success: boolean;
    mediaUrl?: string;
    error?: string;
  }> {
    // 去重检查
    const existing = this.index.entries[url];
    if (existing && fs.existsSync(existing.localPath)) {
      const subDir = mediaType === 'audio' ? 'audio' : 'images';
      return { success: true, mediaUrl: `media://${subDir}/${path.basename(existing.localPath)}` };
    }

    try {
      const response = await net.fetch(url);
      if (!response.ok) return { success: false, error: `HTTP ${response.status}` };

      // 大小检查
      const contentLength = parseInt(response.headers.get('content-length') || '0');
      const limit = SIZE_LIMITS[mediaType] || SIZE_LIMITS.audio;
      if (contentLength > limit) {
        return { success: false, error: `File too large (${Math.round(contentLength / 1024 / 1024)}MB > ${Math.round(limit / 1024 / 1024)}MB limit)` };
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      // SHA256 去重
      const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
      const mimeType = response.headers.get('content-type') || '';
      const ext = MIME_TO_EXT[mimeType.split(';')[0].trim()] || this.extFromUrl(url) || 'bin';
      const prefix = mediaType === 'audio' ? 'audio' : 'img';
      const mediaId = `${prefix}-${hash}`;
      const subDir = mediaType === 'audio' ? 'audio' : 'images';
      const fileName = `${mediaId}.${ext}`;
      const filePath = path.join(MEDIA_DIR, subDir, fileName);

      // 写文件
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, buffer);
      }

      // 更新索引
      this.index.entries[url] = {
        mediaId,
        originalUrl: url,
        localPath: filePath,
        size: buffer.length,
        mimeType,
        createdAt: Date.now(),
      };
      this.saveIndex();

      return { success: true, mediaUrl: `media://${subDir}/${fileName}` };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  private extFromUrl(url: string): string {
    const m = url.match(/\.(\w{2,5})(?:\?|$)/);
    return m?.[1] || '';
  }
}

export const mediaStore = new LocalMediaStore();
