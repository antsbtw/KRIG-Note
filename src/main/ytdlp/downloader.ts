/**
 * yt-dlp Downloader — 视频下载 + 元数据获取 + 字幕保存
 */

import { app } from 'electron';
import { spawn } from 'child_process';
import { writeFileSync } from 'fs';
import { join, dirname, basename, extname } from 'path';
import { getYtdlpPath } from './binary-manager';
import { fetchTranscript } from 'youtube-transcript';

export interface DownloadProgress {
  url: string;
  status: 'downloading' | 'complete' | 'error';
  percent: number;
  filename?: string;
  subtitleFile?: string;     // 原文字幕 .srt 路径
  subtitleText?: string;     // 原文字幕文本（[MM:SS] 格式）
  error?: string;
}

// ── SRT 格式工具 ──

function formatSrtTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const msRem = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(msRem).padStart(3, '0')}`;
}

function segmentsToSrt(segments: Array<{ text: string; offset: number; duration: number }>): string {
  return segments.map((seg, i) => {
    const start = formatSrtTime(seg.offset);
    const end = formatSrtTime(seg.offset + seg.duration);
    return `${i + 1}\n${start} --> ${end}\n${seg.text}\n`;
  }).join('\n');
}

function timestampTextToSrt(text: string): string {
  const lines = text.split('\n').filter(l => l.trim());
  const entries: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*(.*)/);
    if (!m) continue;
    const startSec = m[3] !== undefined
      ? parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3])
      : parseInt(m[1]) * 60 + parseInt(m[2]);
    // 估算结束时间：下一条的开始，或 +5s
    let endSec = startSec + 5;
    if (i + 1 < lines.length) {
      const nextM = lines[i + 1].match(/^\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]/);
      if (nextM) {
        endSec = nextM[3] !== undefined
          ? parseInt(nextM[1]) * 3600 + parseInt(nextM[2]) * 60 + parseInt(nextM[3])
          : parseInt(nextM[1]) * 60 + parseInt(nextM[2]);
      }
    }
    const start = formatSrtTime(startSec * 1000);
    const end = formatSrtTime(endSec * 1000);
    entries.push(`${entries.length + 1}\n${start} --> ${end}\n${m[4]}\n`);
  }
  return entries.join('\n');
}

/** 下载视频，自动下载字幕 */
export async function downloadVideo(
  url: string,
  onProgress?: (progress: DownloadProgress) => void,
  outputPath?: string,
): Promise<DownloadProgress> {
  const binPath = getYtdlpPath();
  if (!binPath) return { url, status: 'error', percent: 0, error: 'yt-dlp not installed' };

  const outputTemplate = outputPath || join(app.getPath('downloads'), '%(title)s.%(ext)s');

  return new Promise((resolve) => {
    let lastPercent = 0;
    let downloadedFilename: string | undefined = outputPath || undefined;

    const args = [
      '-f', 'best[ext=mp4]/best',
      '--no-mtime',
      '--no-check-certificates',
      '-o', outputTemplate,
      url,
    ];

    const proc = spawn(binPath, args);

    const parseLine = (line: string) => {
      const progressMatch = line.match(/\[download\]\s+([\d.]+)%/);
      if (progressMatch) {
        lastPercent = parseFloat(progressMatch[1]);
        onProgress?.({ url, status: 'downloading', percent: lastPercent });
      }
      const destMatch = line.match(/\[download\] Destination:\s+(.+)/);
      if (destMatch) downloadedFilename = destMatch[1].trim();
      const existsMatch = line.match(/\[download\]\s+(.+) has already been downloaded/);
      if (existsMatch) downloadedFilename = existsMatch[1].trim();
      const mergerMatch = line.match(/\[Merger\] Merging formats into "(.+)"/);
      if (mergerMatch) downloadedFilename = mergerMatch[1].trim();
    };

    proc.stdout.on('data', (data: Buffer) => parseLine(data.toString()));
    proc.stderr.on('data', (data: Buffer) => parseLine(data.toString()));

    proc.on('close', async (code) => {
      if (code !== 0) {
        resolve({ url, status: 'error', percent: lastPercent, error: `yt-dlp exited with code ${code}` });
        return;
      }

      // 下载字幕并保存为 .srt 文件
      let subtitleText: string | undefined;
      let subtitleFile: string | undefined;
      try {
        const segments = await fetchTranscript(url);
        if (segments && segments.length > 0) {
          // 生成 [MM:SS] 格式文本
          subtitleText = segments.map((seg: { text: string; offset: number }) => {
            const s = Math.floor(seg.offset / 1000);
            const mm = String(Math.floor(s / 60)).padStart(2, '0');
            const ss = String(s % 60).padStart(2, '0');
            return `[${mm}:${ss}] ${seg.text}`;
          }).join('\n');

          // 保存为 .en.srt（和视频同目录）
          if (downloadedFilename) {
            const dir = dirname(downloadedFilename);
            const base = basename(downloadedFilename, extname(downloadedFilename));
            subtitleFile = join(dir, `${base}.en.srt`);
            const srtContent = segmentsToSrt(segments as Array<{ text: string; offset: number; duration: number }>);
            writeFileSync(subtitleFile, srtContent, 'utf-8');
          }
        }
      } catch { /* ignore transcript errors */ }

      resolve({
        url, status: 'complete', percent: 100,
        filename: downloadedFilename, subtitleFile, subtitleText,
      });
    });

    proc.on('error', (err) => {
      resolve({ url, status: 'error', percent: 0, error: err.message });
    });
  });
}

/** 保存翻译字幕为 .srt 文件 */
export function saveTranslationSubtitle(
  videoFilePath: string,
  langCode: string,
  timestampText: string,
): string {
  const dir = dirname(videoFilePath);
  const base = basename(videoFilePath, extname(videoFilePath));
  const srtPath = join(dir, `${base}.${langCode}.srt`);
  const srtContent = timestampTextToSrt(timestampText);
  writeFileSync(srtPath, srtContent, 'utf-8');
  return srtPath;
}

/** 获取视频元数据（--dump-json） */
export async function getVideoInfo(url: string): Promise<Record<string, unknown> | null> {
  const binPath = getYtdlpPath();
  if (!binPath) return null;

  return new Promise((resolve) => {
    const proc = spawn(binPath, ['--dump-json', '--no-download', url]);
    let output = '';

    proc.stdout.on('data', (data: Buffer) => { output += data.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) { resolve(null); return; }
      try { resolve(JSON.parse(output)); } catch { resolve(null); }
    });
    proc.on('error', () => resolve(null));
  });
}
