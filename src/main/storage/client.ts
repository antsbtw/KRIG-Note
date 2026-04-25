import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { app } from 'electron';
import { Surreal } from 'surrealdb';

/**
 * SurrealDB Client — Sidecar 模式
 *
 * 启动独立 SurrealDB server 进程，通过 WebSocket 连接。
 * 异步初始化，不阻塞窗口显示。
 */

const DEFAULT_PORT = 8532;
const NAMESPACE = 'krig';
const DATABASE = 'krig_note';  // 独立数据库，不和 mirro-desktop 的 'main' 共享

/** 获取或生成 DB 凭据（首次启动时生成随机密码） */
function getCredentials(): { username: string; password: string } {
  const credPath = path.join(app.getPath('userData'), '.db-credentials');
  try {
    if (existsSync(credPath)) {
      const data = JSON.parse(readFileSync(credPath, 'utf-8'));
      if (data.username && data.password) return data;
    }
  } catch {
    // 文件损坏，重新生成
  }
  // 兼容旧版本：如果已有数据库目录，使用旧默认凭据
  const dbPath = path.join(app.getPath('userData'), 'krig-db');
  if (existsSync(dbPath)) {
    const credentials = { username: 'root', password: 'root' };
    const dir = path.dirname(credPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(credPath, JSON.stringify(credentials), 'utf-8');
    return credentials;
  }
  // 全新安装：生成随机密码
  const credentials = { username: 'root', password: randomBytes(24).toString('hex') };
  const dir = path.dirname(credPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(credPath, JSON.stringify(credentials), 'utf-8');
  return credentials;
}

const { username: USERNAME, password: PASSWORD } = getCredentials();
const READY_TIMEOUT = 15000;
const READY_POLL_INTERVAL = 500;

let db: Surreal | null = null;
let serverProcess: ChildProcess | null = null;
let serverPort = DEFAULT_PORT;
let isReady = false;

// ── 状态回调 ──
type ReadyCallback = () => void;
const readyCallbacks: ReadyCallback[] = [];

export function onDBReady(callback: ReadyCallback): void {
  if (isReady) {
    callback();
  } else {
    readyCallbacks.push(callback);
  }
}

export function getDB(): Surreal | null {
  return db;
}

export function isDBReady(): boolean {
  return isReady;
}

export function getConnectionInfo() {
  return {
    endpoint: `http://127.0.0.1:${serverPort}`,
    username: USERNAME,
    password: PASSWORD,
    namespace: NAMESPACE,
    database: DATABASE,
  };
}

// ── Binary 查找 ──

export function findBinary(): string | null {
  const exe = process.platform === 'win32' ? 'surreal.exe' : 'surreal';
  const candidates = [
    // 打包内置（extraResource）
    path.join(process.resourcesPath || '', exe),
    // 用户自带
    path.join(app.getPath('userData'), 'bin', exe),
    // Homebrew (macOS)
    '/opt/homebrew/bin/surreal',
    // 系统安装 (macOS/Linux)
    '/usr/local/bin/surreal',
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

// ── LOCK 清理 ──

function cleanLock(): void {
  const dbPath = path.join(app.getPath('userData'), 'krig-db');
  const lockPath = path.join(dbPath, 'LOCK');
  try {
    if (existsSync(lockPath)) {
      unlinkSync(lockPath);
      console.log('[SurrealDB] Cleaned stale LOCK file');
    }
  } catch (err) {
    console.warn('[SurrealDB] Failed to clean LOCK:', err);
  }
}

// ── 孤儿进程清理 ──

const execFileAsync = promisify(execFile);

/**
 * 杀掉所有指向本 userData/krig-db 的残留 surreal server 进程。
 *
 * 背景：app 崩溃/强制 kill 后，spawn 出去的 surreal 子进程可能变成 PPID=1 的孤儿，
 * 占用端口并继续持有 RocksDB 缓存。这会导致：
 *   1. app 重启时 startServer 因端口冲突 spawn 失败，但仍能连上孤儿 → 数据看似存在
 *   2. 点击"重置数据库"时，我们只 shutdown 了当前 app 派生的 serverProcess（可能为 null），
 *      孤儿继续活着 → 清完磁盘后 app 又连回孤儿内存里的旧数据 → 用户看到"重置不干净"
 *
 * 此函数按 `rocksdb://<dbDir>` 命令行特征匹配进程，kill -9。
 * 幂等：没有匹配到就静默返回。
 */
async function killOrphanSurrealProcesses(reason: string): Promise<void> {
  const dbDir = path.join(app.getPath('userData'), 'krig-db');
  try {
    const { stdout } = await execFileAsync('pgrep', ['-f', `surreal start.*rocksdb://.*${dbDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`]);
    const pids = stdout.split('\n').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0);
    // 排除当前 app 自己派生的 server（那条路径走正常 SIGTERM）
    const ownPid = serverProcess?.pid;
    const orphanPids = pids.filter((pid) => pid !== ownPid);
    if (orphanPids.length === 0) return;

    console.log(`[SurrealDB] Killing orphan server(s) [${reason}]: PIDs=${orphanPids.join(',')}`);
    for (const pid of orphanPids) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* 已死或权限不足 */ }
    }
    // 给 OS 时间释放端口和 LOCK
    await new Promise((r) => setTimeout(r, 500));
  } catch {
    // pgrep 无匹配时退出码 1，execFileAsync 会 reject——视为"无孤儿"，静默
  }
}

// ── Server 启动 ──

async function startServer(): Promise<void> {
  const binary = findBinary();
  if (!binary) {
    console.error('[SurrealDB] Binary not found. Install: brew install surrealdb/tap/surreal');
    return;
  }

  const dbPath = path.join(app.getPath('userData'), 'krig-db');
  // 先清孤儿进程，避免它继续占端口 + 持有 RocksDB 缓存（详见 killOrphanSurrealProcesses 注释）
  await killOrphanSurrealProcesses('pre-start');
  cleanLock();

  console.log(`[SurrealDB] Starting server on port ${serverPort}...`);

  serverProcess = spawn(binary, [
    'start',
    '--bind', `127.0.0.1:${serverPort}`,
    '--username', USERNAME,
    '--password', PASSWORD,
    '--log', 'warn',
    `rocksdb://${dbPath}`,
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout?.on('data', (data: Buffer) => {
    console.log(`[SurrealDB server] ${data.toString().trim()}`);
  });

  serverProcess.stderr?.on('data', (data: Buffer) => {
    console.log(`[SurrealDB server] ${data.toString().trim()}`);
  });

  serverProcess.on('close', (code) => {
    console.log(`[SurrealDB] Server exited with code ${code}`);
    serverProcess = null;
  });

  // 等待就绪
  await waitForReady();
}

async function waitForReady(): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < READY_TIMEOUT) {
    try {
      const res = await fetch(`http://127.0.0.1:${serverPort}/health`);
      if (res.ok) {
        console.log(`[SurrealDB] Server ready on port ${serverPort}`);
        return;
      }
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, READY_POLL_INTERVAL));
  }

  throw new Error(`[SurrealDB] Server failed to start within ${READY_TIMEOUT}ms`);
}

// ── WebSocket 连接 ──

async function connectDB(): Promise<void> {
  db = new Surreal();

  await db.connect(`ws://127.0.0.1:${serverPort}/rpc`);
  await db.signin({ username: USERNAME, password: PASSWORD });
  await db.use({ namespace: NAMESPACE, database: DATABASE });

  console.log(`[SurrealDB] Connected via WebSocket (${NAMESPACE}/${DATABASE})`);
}

// ── 公开 API ──

export async function initSurrealDB(): Promise<void> {
  try {
    await startServer();
    await connectDB();

    isReady = true;

    // 通知所有等待者
    for (const cb of readyCallbacks) {
      try { cb(); } catch (err) { console.error('[SurrealDB] Ready callback error:', err); }
    }
    readyCallbacks.length = 0;
  } catch (err) {
    console.error('[SurrealDB] Init failed:', err);
  }
}

export function shutdownSurrealDB(): void {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
  }

  if (serverProcess) {
    // app 退出时场景：先 SIGTERM，若同步 tick 内进程没响应就 SIGKILL
    // 避免子进程变成孤儿 (PPID=1) 后继续运行并占用数据目录
    try { serverProcess.kill('SIGTERM'); } catch { /* ignore */ }
    // 300ms 后强制 kill（而不是 2 秒，before-quit 往往没这么长时间）
    setTimeout(() => {
      if (serverProcess) {
        try { serverProcess.kill('SIGKILL'); } catch { /* ignore */ }
        serverProcess = null;
      }
    }, 300);
  }

  isReady = false;
}

/**
 * 异步关闭 SurrealDB，等待进程真正退出。
 * 用于 reset/restore 等需要保证磁盘文件可写的场景。
 *
 * 注意：即使本 app 没有派生 serverProcess（serverProcess 为 null），
 * 也要走孤儿清理 —— 当前 app 可能连上的是上轮崩溃残留的孤儿 server，
 * 不杀它会导致 reset 后 app 又连回孤儿的内存缓存（"清了还在"）。
 */
export async function shutdownSurrealDBAsync(): Promise<void> {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
  }

  if (serverProcess) {
    const proc = serverProcess;
    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* ignore */ }
      }, 2000);

      proc.once('close', () => {
        clearTimeout(killTimer);
        resolve();
      });

      try { proc.kill('SIGTERM'); } catch { resolve(); }
    });
    serverProcess = null;
  }

  // 兜底：清掉任何仍在占用 krig-db 的残留 surreal 进程（可能是孤儿，也可能是上面 SIGTERM 后没按时退出的）
  await killOrphanSurrealProcesses('post-shutdown');

  isReady = false;
}
