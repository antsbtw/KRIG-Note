import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { app } from 'electron';
import { findBinary, getConnectionInfo, shutdownSurrealDBAsync, initSurrealDB, getDB } from './client';
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

/** 进度回调——阶段文字 + 可选的 current/total */
export type ProgressReporter = (message: string, current?: number, total?: number) => void;

const noop: ProgressReporter = () => {};

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

/**
 * 重写 managed 书的 file_path 到当前 ebookDir。
 *
 * managed 模式存储约定：文件名 = `${id}${ext}`，位于 ebookDir 下。
 * 备份时存入 DB 的是源机绝对路径，还原后必须用本机当前路径覆盖。
 */
async function rewriteManagedEBookPaths(currentEbookDir: string): Promise<void> {
  const db = getDB();
  if (!db) return;

  const result = await db.query<[Array<{ id: unknown; file_path?: string }>]>(
    `SELECT id, file_path FROM ebook WHERE storage = 'managed'`,
  );
  const rows = result[0] ?? [];

  for (const row of rows) {
    const oldPath = row.file_path;
    if (!oldPath) continue;
    const ext = path.extname(oldPath);
    const idStr = String(row.id).replace(/^ebook:⟨?|⟩?$/g, '');
    const newPath = path.join(currentEbookDir, `${idStr}${ext}`);
    if (newPath === oldPath) continue;
    await db.query(
      `UPDATE type::record('ebook', $id) SET file_path = $file_path`,
      { id: idStr, file_path: newPath },
    );
  }
}

export const backupStore = {
  async backup(destPath: string, reportProgress: ProgressReporter = noop): Promise<BackupResult> {
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

    const TOTAL_STEPS = 6;
    try {
      // 1. surreal export
      reportProgress('导出数据库...', 1, TOTAL_STEPS);
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
      reportProgress('复制媒体文件...', 2, TOTAL_STEPS);
      if (fs.existsSync(paths.mediaDir)) {
        fs.cpSync(paths.mediaDir, path.join(contentDir, 'media'), { recursive: true });
      }

      // 3. 复制 ebook 目录
      reportProgress('复制电子书...', 3, TOTAL_STEPS);
      if (fs.existsSync(paths.ebookDir)) {
        fs.cpSync(paths.ebookDir, path.join(contentDir, 'ebook', 'library'), { recursive: true });
      }

      // 4. 复制 session.json
      reportProgress('保存会话状态...', 4, TOTAL_STEPS);
      if (fs.existsSync(paths.sessionFile)) {
        fs.copyFileSync(paths.sessionFile, path.join(contentDir, 'session.json'));
      }

      // 5. 写入 manifest
      reportProgress('写入元数据...', 5, TOTAL_STEPS);
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
      reportProgress('压缩为归档文件（耗时较长）...', 6, TOTAL_STEPS);
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

  /**
   * 重置数据库 — 清空所有数据，重建空库。
   *
   * 不做自动备份。调用者应提前引导用户手动备份（Note → Backup All Data）。
   */
  async reset(reportProgress: ProgressReporter = noop): Promise<{ success: boolean; error?: string }> {
    const paths = getPaths();
    try {
      // 1. 等待 SurrealDB 完全关闭（确保没有进程占用数据库文件）
      reportProgress('关闭数据库服务...');
      await shutdownSurrealDBAsync();

      // 2. 清空数据目录
      reportProgress('清空数据目录...');
      if (fs.existsSync(paths.dbDir)) {
        fs.rmSync(paths.dbDir, { recursive: true, force: true });
      }
      if (fs.existsSync(paths.mediaDir)) {
        fs.rmSync(paths.mediaDir, { recursive: true, force: true });
      }
      if (fs.existsSync(paths.ebookDir)) {
        fs.rmSync(paths.ebookDir, { recursive: true, force: true });
      }
      if (fs.existsSync(paths.sessionFile)) {
        fs.rmSync(paths.sessionFile, { force: true });
      }

      // 2. 重启空数据库 + 初始化 schema
      reportProgress('初始化空数据库...');
      await initSurrealDB();
      await initSchema();

      console.log('[Reset] Database reset.');
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  },

  async restore(archivePath: string, reportProgress: ProgressReporter = noop): Promise<RestoreResult> {
    const binary = findBinary();
    if (!binary) {
      return { success: false, error: 'SurrealDB binary not found' };
    }

    const paths = getPaths();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krig-restore-'));
    const TOTAL_STEPS = 8;

    try {
      // 1. 解压
      reportProgress('解压备份文件...', 1, TOTAL_STEPS);
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
      reportProgress('验证备份文件...', 2, TOTAL_STEPS);
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

      // 3. 关闭 SurrealDB 并安全重命名旧 DB 目录
      reportProgress('关闭数据库服务...', 3, TOTAL_STEPS);
      await shutdownSurrealDBAsync();

      const preRestoreDir = `${paths.dbDir}.pre-restore`;
      if (fs.existsSync(preRestoreDir)) {
        fs.rmSync(preRestoreDir, { recursive: true, force: true });
      }
      if (fs.existsSync(paths.dbDir)) {
        fs.renameSync(paths.dbDir, preRestoreDir);
      }

      // 4. 启动 SurrealDB（新空库）
      reportProgress('初始化新数据库...', 4, TOTAL_STEPS);
      await initSurrealDB();
      await initSchema();

      // 5. surreal import
      reportProgress('导入数据...', 5, TOTAL_STEPS);
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
        await shutdownSurrealDBAsync();
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
      reportProgress('恢复媒体文件...', 6, TOTAL_STEPS);
      const backupMedia = path.join(contentDir, 'media');
      if (fs.existsSync(backupMedia)) {
        if (fs.existsSync(paths.mediaDir)) {
          fs.rmSync(paths.mediaDir, { recursive: true, force: true });
        }
        fs.cpSync(backupMedia, paths.mediaDir, { recursive: true });
      }

      // 7. 恢复 ebook
      reportProgress('恢复电子书...', 7, TOTAL_STEPS);
      const backupEbook = path.join(contentDir, 'ebook', 'library');
      if (fs.existsSync(backupEbook)) {
        if (fs.existsSync(paths.ebookDir)) {
          fs.rmSync(paths.ebookDir, { recursive: true, force: true });
        }
        fs.mkdirSync(path.dirname(paths.ebookDir), { recursive: true });
        fs.cpSync(backupEbook, paths.ebookDir, { recursive: true });
      }

      // 7b. 重写 managed 书的 file_path —— 备份里存的是源机的绝对路径，
      // 还原到不同 userData（换电脑/重置后）时会失效。按文件名 ${id}${ext}
      // 重新拼接成当前 ebookDir 下的路径。linked 书原样保留（依赖用户原路径）。
      await rewriteManagedEBookPaths(paths.ebookDir);

      // 8. 恢复 session + 清理旧 DB 备份
      reportProgress('清理临时文件...', 8, TOTAL_STEPS);
      const backupSession = path.join(contentDir, 'session.json');
      if (fs.existsSync(backupSession)) {
        fs.copyFileSync(backupSession, paths.sessionFile);
      }
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
