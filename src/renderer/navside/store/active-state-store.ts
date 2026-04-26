/**
 * NavSide ActiveState Store（v1.4 NavSide 重构）。
 *
 * 单一 IPC 入口（`getActiveState` / `onStateChanged` / `onRestoreWorkspaceState`）
 * 由本 store 订阅，所有插件 hook 通过 useActiveState(selector) 消费。
 *
 * 避免每个插件 hook 各自调 IPC 造成 N 倍重复请求 + 重复数据。
 *
 * pub/sub 协议（与 React useSyncExternalStore 兼容）：
 * - subscribe(listener): listener 在 state 变化时被调，返回 unsubscribe
 * - getSnapshot(): 返回当前 state 引用（必须 stable，state 不变时引用也不变）
 *
 * 加载顺序：模块加载时立即 init（自动 wire IPC）。subscribe 时 store 已就绪。
 */

export interface NavSideActiveState {
  /** 当前 workspace 的 workMode id（如 'note' / 'graph' / 'ebook'） */
  workModeId: string;

  // ── Note 业务状态（订阅者：plugin/note/navside）──
  activeNoteId: string | null;
  expandedFolders: Set<string>;

  // ── EBook 业务状态（订阅者：plugin/ebook/navside）──
  activeBookId: string | null;
  ebookExpandedFolders: string[];

  // ── Graph 业务状态（v1.4 M3 启用）──
  activeGraphId: string | null;
  graphExpandedFolders: string[];

  // ── Web 业务状态（v1.4 M5 启用，内存态，不持久化）──
  webExpandedFolders: string[];
}

const INITIAL_STATE: NavSideActiveState = {
  workModeId: '',
  activeNoteId: null,
  expandedFolders: new Set<string>(),
  activeBookId: null,
  ebookExpandedFolders: [],
  activeGraphId: null,
  graphExpandedFolders: [],
  webExpandedFolders: [],
};

type Listener = () => void;

declare const navSideAPI: {
  getActiveState: () => Promise<{
    workspaces: unknown[];
    activeId: string | null;
    active?: {
      workModeId: string;
      activeNoteId?: string | null;
      expandedFolders?: string[];
      activeBookId?: string | null;
      ebookExpandedFolders?: string[];
      activeGraphId?: string | null;
      graphExpandedFolders?: string[];
    };
  }>;
  onStateChanged: (callback: (state: unknown) => void) => () => void;
  onRestoreWorkspaceState: (
    callback: (state: {
      activeNoteId: string | null;
      expandedFolders: string[];
      activeBookId?: string | null;
      ebookExpandedFolders?: string[];
      activeGraphId?: string | null;
      graphExpandedFolders?: string[];
    }) => void,
  ) => () => void;
  setExpandedFolders: (folderIds: string[]) => Promise<void>;
};

class ActiveStateStore {
  private state: NavSideActiveState = INITIAL_STATE;
  private listeners = new Set<Listener>();
  private initialized = false;

  /** 模块加载时自动初始化；幂等 */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    // 拉一次初始状态
    void navSideAPI.getActiveState().then((data) => {
      if (!data.active) return;
      const a = data.active;
      this.set({
        workModeId: a.workModeId,
        activeNoteId: a.activeNoteId ?? null,
        expandedFolders: a.expandedFolders ? new Set(a.expandedFolders) : new Set<string>(),
        activeBookId: a.activeBookId ?? null,
        ebookExpandedFolders: a.ebookExpandedFolders ?? [],
        activeGraphId: a.activeGraphId ?? null,
        graphExpandedFolders: a.graphExpandedFolders ?? [],
        webExpandedFolders: [],
      });
    });

    // 订阅 onStateChanged
    navSideAPI.onStateChanged((data: unknown) => {
      const d = data as {
        active?: {
          workModeId?: string;
          activeNoteId?: string | null;
          activeBookId?: string | null;
          ebookExpandedFolders?: string[];
          activeGraphId?: string | null;
          graphExpandedFolders?: string[];
        };
      };
      if (!d.active) return;
      const next: Partial<NavSideActiveState> = {};
      if (d.active.workModeId !== undefined) next.workModeId = d.active.workModeId;
      if (d.active.activeNoteId !== undefined) next.activeNoteId = d.active.activeNoteId;
      if (d.active.activeBookId !== undefined) next.activeBookId = d.active.activeBookId;
      if (d.active.ebookExpandedFolders) next.ebookExpandedFolders = d.active.ebookExpandedFolders;
      if (d.active.activeGraphId !== undefined) next.activeGraphId = d.active.activeGraphId;
      if (d.active.graphExpandedFolders) next.graphExpandedFolders = d.active.graphExpandedFolders;
      this.merge(next);
    });

    // 订阅 onRestoreWorkspaceState（切 workspace 时主进程触发）
    navSideAPI.onRestoreWorkspaceState((s) => {
      const next: Partial<NavSideActiveState> = {};
      if (s.activeNoteId !== undefined) next.activeNoteId = s.activeNoteId;
      if (s.expandedFolders) next.expandedFolders = new Set(s.expandedFolders);
      if (s.activeBookId !== undefined) next.activeBookId = s.activeBookId;
      if (s.ebookExpandedFolders) next.ebookExpandedFolders = s.ebookExpandedFolders;
      if (s.activeGraphId !== undefined) next.activeGraphId = s.activeGraphId;
      if (s.graphExpandedFolders) next.graphExpandedFolders = s.graphExpandedFolders;
      this.merge(next);
    });
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): NavSideActiveState => this.state;

  /** 内部 merge（保持引用语义：未变字段共享） */
  private merge(partial: Partial<NavSideActiveState>): void {
    const changed = Object.entries(partial).some(([k, v]) => {
      const cur = (this.state as unknown as Record<string, unknown>)[k];
      // Set 比较：浅比较 size + 内容
      if (v instanceof Set && cur instanceof Set) {
        if (v.size !== cur.size) return true;
        for (const x of v) if (!cur.has(x)) return true;
        return false;
      }
      // 数组浅比较
      if (Array.isArray(v) && Array.isArray(cur)) {
        if (v.length !== cur.length) return true;
        return v.some((x, i) => x !== cur[i]);
      }
      return v !== cur;
    });
    if (!changed) return;
    this.state = { ...this.state, ...partial };
    this.notify();
  }

  /** 完整覆盖（init 时用） */
  private set(state: NavSideActiveState): void {
    this.state = state;
    this.notify();
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  // ── 写操作（业务 hook 调，触发 IPC + 本地更新） ──

  /** Note 折叠状态变更：写主进程 + 本地更新（触发 useActiveState 重渲） */
  updateNoteExpandedFolders(folders: Set<string>): void {
    this.merge({ expandedFolders: folders });
    void navSideAPI.setExpandedFolders(Array.from(folders));
  }

  /** 设置当前活跃 noteId（不触发 IPC——主进程 onStateChanged 会回流） */
  setActiveNoteIdLocal(id: string | null): void {
    this.merge({ activeNoteId: id });
  }
  setActiveBookIdLocal(id: string | null): void {
    this.merge({ activeBookId: id });
  }
  setEBookExpandedFoldersLocal(folders: string[]): void {
    this.merge({ ebookExpandedFolders: folders });
  }
  setActiveGraphIdLocal(id: string | null): void {
    this.merge({ activeGraphId: id });
  }
  setGraphExpandedFoldersLocal(folders: string[]): void {
    this.merge({ graphExpandedFolders: folders });
  }
  setWebExpandedFoldersLocal(folders: string[]): void {
    this.merge({ webExpandedFolders: folders });
  }
}

export const activeStateStore = new ActiveStateStore();

// 模块加载时立即初始化
if (typeof navSideAPI !== 'undefined') {
  activeStateStore.init();
}
