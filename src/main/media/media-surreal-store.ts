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
  for (const sub of ['images', 'audio', 'files']) {
    fs.mkdirSync(path.join(MEDIA_DIR, sub), { recursive: true });
  }
}

function extFromUrl(url: string): string {
  const m = url.match(/\.(\w{2,5})(?:\?|$)/);
  return m?.[1] || '';
}

/**
 * Map a MIME type to our on-disk extension. Falls back to `bin` for types
 * we don't know about.
 */
function extForMime(mimeType: string): string {
  const core = mimeType.split(';')[0].trim();
  return MIME_TO_EXT[core] || 'bin';
}

/**
 * Bucket a MIME type into the on-disk subdirectory under MEDIA_DIR.
 *
 *   image/*         → 'images'
 *   audio/*         → 'audio'
 *   anything else   → 'files'    (pdf, zip, csv, html, tsx, ...)
 *
 * `video/*` currently lands in `files` because we haven't needed a
 * dedicated video bucket yet — the existing video-block uses external
 * URLs (YouTube/Vimeo). Can be upgraded to 'videos' later if needed.
 */
function bucketForMime(mimeType: string): 'images' | 'audio' | 'files' {
  const core = mimeType.split(';')[0].trim();
  if (core.startsWith('image/')) return 'images';
  if (core.startsWith('audio/')) return 'audio';
  return 'files';
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

  /**
   * Store a base64 blob (e.g. an AI-extracted Imagen / DALL·E / matplotlib
   * image) on disk, index it in SurrealDB, and return a `media://...` URL
   * that renderers can embed directly.
   *
   * Deduplicated by SHA-256 of the decoded bytes — feeding the same image
   * in twice yields the same mediaUrl without writing the file again.
   *
   * Accepts either a full `data:<mime>;base64,<b64>` URL or a raw base64
   * string together with an explicit `mimeType`.
   */
  async putBase64(
    input: string,
    explicitMime?: string,
  ): Promise<{ success: boolean; mediaUrl?: string; mediaId?: string; error?: string }> {
    try {
      // Parse data URL vs raw base64
      let b64: string;
      let mimeType = explicitMime || '';
      const m = input.match(/^data:([^;]+);base64,(.*)$/s);
      if (m) {
        mimeType = mimeType || m[1];
        b64 = m[2];
      } else {
        b64 = input;
      }
      if (!b64) return { success: false, error: 'empty base64 payload' };
      if (!mimeType) return { success: false, error: 'no mimeType for raw base64' };

      ensureDirs();
      const buffer = Buffer.from(b64, 'base64');
      if (buffer.length === 0) return { success: false, error: 'decoded buffer is empty' };

      const subDir = bucketForMime(mimeType);
      // Size limit by bucket. 'files' inherits image's 20MB for v1;
      // upgrade to a larger/unlimited cap for AI-generated reports etc.
      const sizeKey = subDir === 'images' ? 'image' : subDir === 'audio' ? 'audio' : 'image';
      const limit = SIZE_LIMITS[sizeKey];
      if (buffer.length > limit) {
        return { success: false, error: `Data too large (${Math.round(buffer.length / 1024 / 1024)}MB > ${Math.round(limit / 1024 / 1024)}MB limit)` };
      }

      const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
      const ext = extForMime(mimeType);
      const prefix = subDir === 'audio' ? 'audio' : subDir === 'images' ? 'img' : 'file';
      const mediaId = `${prefix}-${hash}`;
      const fileName = `${mediaId}.${ext}`;
      const filePath = path.join(MEDIA_DIR, subDir, fileName);
      const mediaUrl = `media://${subDir}/${fileName}`;

      // Dedup: if the file already exists on disk, treat as cached.
      const db = getDB();
      if (fs.existsSync(filePath)) {
        // Ensure a DB row exists too (in case a previous run wrote disk but
        // failed on DB); query-by-id is cheap.
        if (db) {
          try {
            const rows = await db.query<[any[]]>(
              `SELECT id FROM media WHERE id = $id LIMIT 1`,
              { id: mediaId },
            );
            const exists = rows[0]?.[0];
            if (!exists) {
              await db.query(
                `CREATE media SET id = $id, original_url = $url, local_path = $local_path, size = $size, mime_type = $mime_type, created_at = $created_at`,
                {
                  id: mediaId,
                  url: mediaUrl,
                  local_path: filePath,
                  size: buffer.length,
                  mime_type: mimeType,
                  created_at: Date.now(),
                },
              );
            }
          } catch {
            /* non-fatal: renderer can still load the file via protocol */
          }
        }
        return { success: true, mediaUrl, mediaId };
      }

      fs.writeFileSync(filePath, buffer);
      if (db) {
        try {
          await db.query(
            `CREATE media SET id = $id, original_url = $url, local_path = $local_path, size = $size, mime_type = $mime_type, created_at = $created_at`,
            {
              id: mediaId,
              url: mediaUrl,
              local_path: filePath,
              size: buffer.length,
              mime_type: mimeType,
              created_at: Date.now(),
            },
          );
        } catch {
          /* non-fatal */
        }
      }

      return { success: true, mediaUrl, mediaId };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  },
};
