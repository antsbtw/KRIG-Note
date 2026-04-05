// ─── L3: View 基础类型 ───

/** View 的基础类型分类（插件注册） */
export type ViewType = 'note' | 'pdf' | 'web' | 'graph';

/** View 实例 ID（格式: '{type}-{workspaceId}-{counter}'） */
export type ViewInstanceId = string;

/** Slot 位置 */
export type SlotSide = 'left' | 'right';

/** 授权级别 */
export type LicenseTier = 'free' | 'pro' | 'premium';

// ─── L2: Workspace ───

/** Workspace ID */
export type WorkspaceId = string;

/** Workspace 在任意时刻的完整状态 */
export interface WorkspaceState {
  id: WorkspaceId;
  label: string;
  customLabel: boolean;              // true = 用户手动命名，不自动跟随笔记标题
  workModeId: string;
  navSideVisible: boolean;
  dividerRatio: number;
  activeNoteId: string | null;        // NoteView 当前打开的笔记 ID
  expandedFolders: string[];          // NavSide 展开的文件夹 ID 列表
  slotBinding: {
    left: ViewInstanceId | null;
    right: ViewInstanceId | null;
  };
}

// ─── View 接口 ───

/** View 的位置和大小 */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** View 创建配置 */
export interface ViewConfig {
  type: ViewType;
  variant?: string;
  instanceId: ViewInstanceId;
  data?: Record<string, unknown>;
}

/** View 持久化数据 */
export interface PersistedViewState {
  instanceId: ViewInstanceId;
  type: ViewType;
  variant?: string;
  data: Record<string, unknown>;
}

/** View 接口 — 所有 View 插件必须实现 */
export interface ViewInterface {
  readonly type: ViewType;
  readonly variant?: string;
  readonly instanceId: ViewInstanceId;

  create(config: ViewConfig): void;
  show(bounds: Bounds): void;
  hide(): void;
  destroy(): Promise<void>;

  getState(): PersistedViewState;
  restoreState(state: PersistedViewState): void;

  focus(): void;
  blur(): void;
}

// ─── 注册接口 ───

/** View 类型注册 */
export interface ViewTypeRegistration {
  type: ViewType;
  variants?: string[];
  tier: LicenseTier;
}

/** WorkMode 注册 */
export interface WorkModeRegistration {
  id: string;
  viewType: ViewType;
  variant?: string;
  icon: string;
  label: string;
  order: number;
}

/** 协同协议匹配条件 */
export interface ProtocolMatch {
  left: { type: ViewType; variant?: string };
  right: { type: ViewType; variant?: string };
}

/** 协同协议注册 */
export interface ProtocolRegistration {
  id: string;
  match: ProtocolMatch;
}

// ─── View 间消息（双工通信） ───

/** View 间通信消息 — 框架只路由，不解析 payload */
export interface ViewMessage {
  protocol: string;      // 协议 id（如 'anchor', 'page-sync', 'translate', 'demo'）
  action: string;        // 操作名（如 'scrollTo', 'highlight', 'ping'）
  payload: unknown;      // 任意 JSON，由 View 自己编解码
}

// ─── IPC 通道 ───

export const IPC = {
  // Workspace 操作
  WORKSPACE_CREATE: 'workspace:create',
  WORKSPACE_SWITCH: 'workspace:switch',
  WORKSPACE_CLOSE: 'workspace:close',
  WORKSPACE_RENAME: 'workspace:rename',
  WORKSPACE_REORDER: 'workspace:reorder',
  WORKSPACE_LIST: 'workspace:list',
  WORKSPACE_STATE_CHANGED: 'workspace:state-changed',

  // WorkMode 操作
  WORKMODE_SWITCH: 'workmode:switch',
  WORKMODE_LIST: 'workmode:list',

  // Slot 操作
  SLOT_OPEN_RIGHT: 'slot:open-right',
  SLOT_CLOSE_RIGHT: 'slot:close-right',
  SLOT_DIVIDER_CHANGED: 'slot:divider-changed',

  // Divider 拖拽
  DIVIDER_DRAG_START: 'divider:drag-start',
  DIVIDER_DRAG_MOVE: 'divider:drag-move',
  DIVIDER_DRAG_END: 'divider:drag-end',

  // View 间消息（双工）
  VIEW_MESSAGE_SEND: 'view:message-send',
  VIEW_MESSAGE_RECEIVE: 'view:message-receive',

  // NavSide 操作
  NAVSIDE_TOGGLE: 'navside:toggle',
  NAVSIDE_STATE: 'navside:state',
  NAVSIDE_RESIZE_START: 'navside:resize-start',
  NAVSIDE_RESIZE_MOVE: 'navside:resize-move',
  NAVSIDE_RESIZE_END: 'navside:resize-end',

  // NoteFile 操作
  NOTE_CREATE: 'note:create',
  NOTE_SAVE: 'note:save',
  NOTE_LOAD: 'note:load',
  NOTE_DELETE: 'note:delete',
  NOTE_RENAME: 'note:rename',
  NOTE_LIST: 'note:list',
  NOTE_LIST_CHANGED: 'note:list-changed',

  NOTE_MOVE_TO_FOLDER: 'note:move-to-folder',

  // NoteFile 编辑器操作
  NOTE_OPEN_IN_EDITOR: 'note:open-in-editor',
  NOTE_TITLE_CHANGED: 'note:title-changed',  // NavSide → NoteView: 文件名变更同步到 noteTitle

  // Folder 操作
  FOLDER_CREATE: 'folder:create',
  FOLDER_RENAME: 'folder:rename',
  FOLDER_DELETE: 'folder:delete',
  FOLDER_MOVE: 'folder:move',
  FOLDER_LIST: 'folder:list',

  // Workspace ↔ View 状态同步
  SET_ACTIVE_NOTE: 'workspace:set-active-note',            // NoteView → main: 报告当前打开的笔记
  SET_EXPANDED_FOLDERS: 'workspace:set-expanded-folders',  // NavSide → main: 保存展开的文件夹
  RESTORE_WORKSPACE_STATE: 'workspace:restore-state',      // main → NavSide/NoteView: 切换 Workspace 时恢复状态

  // 测试文档
  LOAD_TEST_DOC: 'note:load-test-doc',

  // SurrealDB 状态
  DB_READY: 'db:ready',
  IS_DB_READY: 'db:is-ready',

  // 文件保存对话框
  FILE_SAVE_DIALOG: 'file:save-dialog',
} as const;
