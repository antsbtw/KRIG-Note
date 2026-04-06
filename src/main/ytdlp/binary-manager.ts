/**
 * yt-dlp Binary Manager — 下载、安装、版本检测
 *
 * 存储位置：{userData}/bin/yt-dlp
 * 下载源：GitHub Releases (macOS universal binary, ~22MB, 无需 Python)
 */

import { app, net } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';

const BIN_DIR = path.join(app.getPath('userData'), 'bin');
const YTDLP_PATH = path.join(BIN_DIR, 'yt-dlp');
const DOWNLOAD_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';

export interface YtdlpStatus {
  installed: boolean;
  version?: string;
  path?: string;
}

/** 检查 yt-dlp 是否已安装 */
export async function checkStatus(): Promise<YtdlpStatus> {
  if (!fs.existsSync(YTDLP_PATH)) {
    return { installed: false };
  }
  try {
    const version = await new Promise<string>((resolve, reject) => {
      execFile(YTDLP_PATH, ['--version'], (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout.trim());
      });
    });
    return { installed: true, version, path: YTDLP_PATH };
  } catch {
    return { installed: false };
  }
}

/** 下载并安装 yt-dlp binary */
export async function install(
  onProgress?: (percent: number) => void,
): Promise<YtdlpStatus> {
  fs.mkdirSync(BIN_DIR, { recursive: true });

  const response = await net.fetch(DOWNLOAD_URL);
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }

  const totalBytes = parseInt(response.headers.get('content-length') || '0', 10);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const chunks: Uint8Array[] = [];
  let downloadedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    downloadedBytes += value.length;
    if (totalBytes > 0 && onProgress) {
      onProgress(Math.round((downloadedBytes / totalBytes) * 100));
    }
  }

  // 合并 chunks 写入文件
  const buffer = Buffer.concat(chunks);
  fs.writeFileSync(YTDLP_PATH, buffer);
  fs.chmodSync(YTDLP_PATH, 0o755);

  // macOS: 移除 Gatekeeper 隔离属性
  try {
    const { execSync } = require('child_process');
    execSync(`xattr -dr com.apple.quarantine "${YTDLP_PATH}"`, { stdio: 'ignore' });
  } catch { /* ignore */ }

  return checkStatus();
}

/** 获取 binary 路径（未安装返回 null） */
export function getYtdlpPath(): string | null {
  return fs.existsSync(YTDLP_PATH) ? YTDLP_PATH : null;
}
