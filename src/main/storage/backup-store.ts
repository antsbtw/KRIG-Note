import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { app } from 'electron';
import { findBinary, getConnectionInfo, shutdownSurrealDB, initSurrealDB } from './client';
import { initSchema } from './schema';

/**
 * Backup / Restore — 数据安全网
 *
 * Backup：surreal export → database.surql + 文件复制 → tar.gz
 * Restore：tar.gz 解压 → surreal import + 文件恢复
 */

export interface BackupResult {
  success: boolean;
  path?: string;
  size?: number;
  error?: string;
}

export interface RestoreResult {
  success: boolean;
  error?: string;
}

/** 数据目录路径 */
function getPaths() {
  const userData = app.getPath('userData');
  return {
    dbDir: path.join(userData, 'krig-db'),
    mediaDir: path.join(userData, 'krig-data', 'media'),
    ebookDir: path.join(userData, 'krig-note', 'ebook', 'library'),
    sessionFile: path.join(userData, 'session.json'),
  };
}

/** 执行子进程，返回 Promise */
function run(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    proc.on('error', (err) => resolve({ code: 1, stdout: '', stderr: err.message }));
  });
}

export const backupStore = {
  async backup(destPath: string): Promise<BackupResult> {
    const binary = findBinary();
    if (!binary) {
      return { success: false, error: 'SurrealDB binary not found' };
    }

    const conn = getConnectionInfo();
    const paths = getPaths();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krig-backup-'));
    const backupName = `krig-backup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
    const contentDir = path.join(tmpDir, backupName);
    fs.mkdirSync(contentDir, { recursive: true });

    try {
      // 1. surreal export
      const surqlPath = path.join(contentDir, 'database.surql');
      const exportResult = await run(binary, [
        'export',
        '--endpoint', conn.endpoint,
        '--username', conn.username,
        '--password', conn.password,
        '--namespace', conn.namespace,
        '--database', conn.database,
        surqlPath,
      ]);
      if (exportResult.code !== 0) {
        return { success: false, error: `surreal export failed: ${exportResult.stderr}` };
      }

      // 2. 复制 media 目录
      if (fs.existsSync(paths.mediaDir)) {
        fs.cpSync(paths.mediaDir, path.join(contentDir, 'media'), { recursive: true });
      }

      // 3. 复制 ebook 目录
      if (fs.existsSync(paths.ebookDir)) {
        fs.cpSync(paths.ebookDir, path.join(contentDir, 'ebook', 'library'), { recursive: true });
      }

      // 4. 复制 session.json
      if (fs.existsSync(paths.sessionFile)) {
        fs.copyFileSync(paths.sessionFile, path.join(contentDir, 'session.json'));
      }

      // 5. 写入 manifest
      fs.writeFileSync(path.join(contentDir, 'manifest.json'), JSON.stringify({
        version: 1,
        createdAt: new Date().toISOString(),
        app: 'KRIG Note',
        tables: [
          'note', 'thought', 'folder', 'activity', 'vocab',
          'ebook', 'ebook_folder', 'annotation',
          'bookmark', 'bookmark_folder', 'web_history',
          'media', 'sourced_from', 'clipped_from', 'links_to', 'thought_of',
        ],
      }, null, 2));

      // 6. tar 打包
      const tarResult = await run('tar', ['-czf', destPath, '-C', tmpDir, backupName]);
      if (tarResult.code !== 0) {
        return { success: false, error: `tar failed: ${tarResult.stderr}` };
      }

      const stat = fs.statSync(destPath);
      console.log(`[Backup] Created: ${destPath} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
      return { success: true, path: destPath, size: stat.size };
    } catch (err) {
      return { success: false, error: String(err) };
    } finally {
      // 清理临时目录
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  },

  async restore(archivePath: string): Promise<RestoreResult> {
    const binary = findBinary();
    if (!binary) {
      return { success: false, error: 'SurrealDB binary not found' };
    }

    const paths = getPaths();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krig-restore-'));

    try {
      // 1. 解压
      const extractResult = await run('tar', ['-xzf', archivePath, '-C', tmpDir]);
      if (extractResult.code !== 0) {
        return { success: false, error: `tar extract failed: ${extractResult.stderr}` };
      }

      // 找到解压后的顶层目录
      const entries = fs.readdirSync(tmpDir);
      const contentDir = entries.length === 1
        ? path.join(tmpDir, entries[0])
        : tmpDir;

      // 2. 验证 manifest
      const manifestPath = path.join(contentDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        return { success: false, error: 'Invalid backup: manifest.json not found' };
      }
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      if (manifest.version !== 1 || manifest.app !== 'KRIG Note') {
        return { success: false, error: `Unsupported backup version: ${manifest.version}` };
      }

      const surqlPath = path.join(contentDir, 'database.surql');
      if (!fs.existsSync(surqlPath)) {
        return { success: false, error: 'Invalid backup: database.surql not found' };
      }

      // 3. 安全回退：重命名旧 DB 目录
      const preRestoreDir = `${paths.dbDir}.pre-restore`;
      if (fs.existsSync(preRestoreDir)) {
        fs.rmSync(preRestoreDir, { recursive: true, force: true });
      }
      if (fs.existsSync(paths.dbDir)) {
        fs.renameSync(paths.dbDir, preRestoreDir);
      }

      // 4. 重启 SurrealDB（新空库）
      shutdownSurrealDB();
      await initSurrealDB();
      await initSchema();

      // 5. surreal import
      const conn = getConnectionInfo();
      const importResult = await run(binary, [
        'import',
        '--endpoint', conn.endpoint,
        '--username', conn.username,
        '--password', conn.password,
        '--namespace', conn.namespace,
        '--database', conn.database,
        surqlPath,
      ]);
      if (importResult.code !== 0) {
        // 回滚：恢复旧 DB
        shutdownSurrealDB();
        if (fs.existsSync(paths.dbDir)) {
          fs.rmSync(paths.dbDir, { recursive: true, force: true });
        }
        if (fs.existsSync(preRestoreDir)) {
          fs.renameSync(preRestoreDir, paths.dbDir);
        }
        await initSurrealDB();
        await initSchema();
        return { success: false, error: `surreal import failed: ${importResult.stderr}` };
      }

      // 6. 恢复 media
      const backupMedia = path.join(contentDir, 'media');
      if (fs.existsSync(backupMedia)) {
        if (fs.existsSync(paths.mediaDir)) {
          fs.rmSync(paths.mediaDir, { recursive: true, force: true });
        }
        fs.cpSync(backupMedia, paths.mediaDir, { recursive: true });
      }

      // 7. 恢复 ebook
      const backupEbook = path.join(contentDir, 'ebook', 'library');
      if (fs.existsSync(backupEbook)) {
        if (fs.existsSync(paths.ebookDir)) {
          fs.rmSync(paths.ebookDir, { recursive: true, force: true });
        }
        fs.mkdirSync(path.dirname(paths.ebookDir), { recursive: true });
        fs.cpSync(backupEbook, paths.ebookDir, { recursive: true });
      }

      // 8. 恢复 session
      const backupSession = path.join(contentDir, 'session.json');
      if (fs.existsSync(backupSession)) {
        fs.copyFileSync(backupSession, paths.sessionFile);
      }

      // 9. 清理旧 DB 备份
      if (fs.existsSync(preRestoreDir)) {
        fs.rmSync(preRestoreDir, { recursive: true, force: true });
      }

      console.log(`[Backup] Restored from: ${archivePath} (backup date: ${manifest.createdAt})`);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  },
};
