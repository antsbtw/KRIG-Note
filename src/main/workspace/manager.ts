import { WorkspaceState, WorkspaceId } from '../../shared/types';
import { workModeRegistry } from '../workmode/registry';

/**
 * Workspace 管理器
 *
 * 管理所有 Workspace 的状态和生命周期。
 * Workspace 是逻辑实体，不是 UI 组件。
 */
class WorkspaceManager {
  private workspaces: Map<WorkspaceId, WorkspaceState> = new Map();
  private activeId: WorkspaceId | null = null;
  private counter = 0;

  /** 创建新 Workspace */
  create(label?: string): WorkspaceState {
    const id = `ws-${++this.counter}`;
    const defaultMode = workModeRegistry.getDefault();

    const workspace: WorkspaceState = {
      id,
      label: label ?? `Workspace ${this.counter}`,
      customLabel: !!label,
      workModeId: defaultMode?.id ?? '',
      navSideVisible: true,
      dividerRatio: 0.5,
      activeNoteId: null,
      expandedFolders: [],
      activeBookId: null,
      ebookExpandedFolders: [],
      slotBinding: {
        left: null,
        right: null,
      },
    };

    this.workspaces.set(id, workspace);
    return workspace;
  }

  /** 切换活跃 Workspace */
  setActive(id: WorkspaceId): WorkspaceState | undefined {
    const workspace = this.workspaces.get(id);
    if (!workspace) return undefined;
    this.activeId = id;
    return workspace;
  }

  /** 获取活跃 Workspace */
  getActive(): WorkspaceState | undefined {
    if (!this.activeId) return undefined;
    return this.workspaces.get(this.activeId);
  }

  /** 获取活跃 Workspace ID */
  getActiveId(): WorkspaceId | null {
    return this.activeId;
  }

  /** 获取指定 Workspace */
  get(id: WorkspaceId): WorkspaceState | undefined {
    return this.workspaces.get(id);
  }

  /** 获取所有 Workspace（按创建顺序） */
  getAll(): WorkspaceState[] {
    return Array.from(this.workspaces.values());
  }

  /** 更新 Workspace 状态 */
  update(id: WorkspaceId, partial: Partial<WorkspaceState>): WorkspaceState | undefined {
    const workspace = this.workspaces.get(id);
    if (!workspace) return undefined;

    const updated = { ...workspace, ...partial, id }; // id 不可变
    this.workspaces.set(id, updated);
    return updated;
  }

  /** 关闭 Workspace */
  close(id: WorkspaceId): WorkspaceId | null {
    if (!this.workspaces.has(id)) return null;

    this.workspaces.delete(id);

    // 如果关闭的是活跃 Workspace，切换到相邻的
    if (this.activeId === id) {
      const remaining = this.getAll();
      if (remaining.length > 0) {
        this.activeId = remaining[remaining.length - 1].id;
      } else {
        // 至少保留一个 Workspace
        const newWorkspace = this.create();
        this.activeId = newWorkspace.id;
      }
    }

    return this.activeId;
  }

  /** 重命名 Workspace */
  rename(id: WorkspaceId, label: string): void {
    this.update(id, { label });
  }

  /** 按指定 ID 顺序重排 Workspace */
  reorder(ids: WorkspaceId[]): void {
    const newMap = new Map<WorkspaceId, WorkspaceState>();
    for (const id of ids) {
      const ws = this.workspaces.get(id);
      if (ws) newMap.set(id, ws);
    }
    // 保留未在列表中的（理论上不应该有）
    for (const [id, ws] of this.workspaces) {
      if (!newMap.has(id)) newMap.set(id, ws);
    }
    this.workspaces = newMap;
  }

  /** Workspace 数量 */
  get count(): number {
    return this.workspaces.size;
  }
}

export const workspaceManager = new WorkspaceManager();
