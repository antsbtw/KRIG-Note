import { app, protocol, net } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { getDB } from '../storage/client';

/**
 * MediaStore — SurrealDB 版本
 *
 * 替代原 JSON 索引 media-store.ts。
 * 表：media（媒体索引）
 *
 * 二进制文件仍然存储在本地文件系统中，
 * SurrealDB 只管理索引/元数据。
 */

const MEDIA_DIR = path.join(app.getPath('userData'), 'krig-data', 'media');

const SIZE_LIMITS: Record<string, number> = {
  audio: 50 * 1024 * 1024,
  video: 200 * 1024 * 1024,
  image: 20 * 1024 * 1024,
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

function ensureDirs(): void {
  for (const sub of ['images', 'audio']) {
    fs.mkdirSync(path.join(MEDIA_DIR, sub), { recursive: true });
  }
}

function extFromUrl(url: string): string {
  const m = url.match(/\.(\w{2,5})(?:\?|$)/);
  return m?.[1] || '';
}

export const mediaSurrealStore = {
  /** 注册 media:// 协议 */
  registerProtocol(): void {
    ensureDirs();
    protocol.handle('media', (request) => {
      const urlPath = request.url.replace('media://', '');
      const filePath = path.join(MEDIA_DIR, urlPath);
      return net.fetch(`file://${filePath}`);
    });
  },

  /** 下载远程媒体到本地 */
  async download(url: string, mediaType: 'audio' | 'image'): Promise<{
    success: boolean;
    mediaUrl?: string;
    error?: string;
  }> {
    const db = getDB();

    // 去重检查：先查 SurrealDB
    if (db) {
      const result = await db.query<[any[]]>(
        `SELECT * FROM media WHERE original_url = $url LIMIT 1`,
        { url },
      );
      const existing = result[0]?.[0];
      if (existing && fs.existsSync(existing.local_path)) {
        const subDir = mediaType === 'audio' ? 'audio' : 'images';
        return { success: true, mediaUrl: `media://${subDir}/${path.basename(existing.local_path)}` };
      }
    }

    try {
      ensureDirs();
      const response = await net.fetch(url);
      if (!response.ok) return { success: false, error: `HTTP ${response.status}` };

      const contentLength = parseInt(response.headers.get('content-length') || '0');
      const limit = SIZE_LIMITS[mediaType] || SIZE_LIMITS.audio;
      if (contentLength > limit) {
        return { success: false, error: `File too large (${Math.round(contentLength / 1024 / 1024)}MB > ${Math.round(limit / 1024 / 1024)}MB limit)` };
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
      const mimeType = response.headers.get('content-type') || '';
      const ext = MIME_TO_EXT[mimeType.split(';')[0].trim()] || extFromUrl(url) || 'bin';
      const prefix = mediaType === 'audio' ? 'audio' : 'img';
      const mediaId = `${prefix}-${hash}`;
      const subDir = mediaType === 'audio' ? 'audio' : 'images';
      const fileName = `${mediaId}.${ext}`;
      const filePath = path.join(MEDIA_DIR, subDir, fileName);

      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, buffer);
      }

      // 写入 SurrealDB 索引
      if (db) {
        await db.query(
          `CREATE media SET id = $id, original_url = $original_url, local_path = $local_path, size = $size, mime_type = $mime_type, created_at = $created_at`,
          {
            id: mediaId,
            original_url: url,
            local_path: filePath,
            size: buffer.length,
            mime_type: mimeType,
            created_at: Date.now(),
          },
        );
      }

      return { success: true, mediaUrl: `media://${subDir}/${fileName}` };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  },
};
