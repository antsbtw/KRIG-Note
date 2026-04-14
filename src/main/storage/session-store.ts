import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { WorkspaceState, WorkspaceId } from '../../shared/types';

/**
 * Session 持久化（JSON 文件）
 *
 * 保存/恢复 Workspace 布局状态。
 * 文件位置：{userData}/session.json
 *
 * 这是 IStorage 的 Phase 1 实现（JSON 文件）。
 */

interface PersistedSession {
  activeWorkspaceId: string | null;
  workspaces: WorkspaceState[];
  navSideWidth?: number;  // 已废弃：迁移用，新版本中 navSideWidth 存在各 WorkspaceState 中
}

const SESSION_FILE = 'session.json';

function getSessionPath(): string {
  return path.join(app.getPath('userData'), SESSION_FILE);
}

/** 读取 Session */
export function loadSession(): PersistedSession | null {
  try {
    const filePath = getSessionPath();
    if (!fs.existsSync(filePath)) return null;
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as PersistedSession;
  } catch {
    return null;
  }
}

/** 保存 Session */
export function saveSession(session: PersistedSession): void {
  try {
    const filePath = getSessionPath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save session:', err);
  }
}

/** 从当前状态构建 PersistedSession */
export function buildSession(
  workspaces: WorkspaceState[],
  activeId: string | null,
): PersistedSession {
  return {
    activeWorkspaceId: activeId,
    workspaces,
  };
}
