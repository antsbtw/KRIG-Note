/**
 * 渲染与状态层 Schema (Visualization / UI State)
 * 
 * 职能：运行期为了 UI 渲染和交互而存在的缓存状态。
 * 绝对禁止存入主数据库。
 */

// ── 1. 应用瞬时布局与状态 ──

/** View 的位置和大小（L4 物理槽位几何信息） */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type WorkspaceId = string;
export type ViewInstanceId = string;

/** 
 * Workspace 在任意时刻的运行态缓存
 * (移除了所有强业务字段如 activeNoteId)
 */
export interface WorkspaceState {
  id: WorkspaceId;
  label: string;
  customLabel: boolean;              // true = 用户手动命名，不自动跟随笔记标题
  workModeId: string;
  navSideVisible: boolean;
  navSideWidth: number | null;       // 每个 Workspace 独立的 NavSide 宽度，null = 使用默认值
  dividerRatio: number;

  slotBinding: {
    left: ViewInstanceId | null;
    right: ViewInstanceId | null;
  };

  /** 各插件内部自己的运行态上下文（不存入 DB，仅暂存于 Workspace 缓存） */
  pluginStates: Record<string, PluginUIState>;
}

// ── 2. 插件私有运行态 (Plugin UI State) ──

export interface PluginUIState {
  viewType: 'note' | 'ebook' | 'graph' | 'web';
  activeItemId: string | null;     // 当前浏览的 ID
  scrollPosition: number;          // 滚动条位置
  selection?: { start: number, end: number }; // 光标
  localExpandedFolders?: string[]; // 树形列表展开态
}

// ── 3. 侧边栏与菜单配置 (UI 配置) ──

export interface NavSideContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  separator?: boolean;
}

export interface NavSideRegistration {
  workModeId: string;
  actionBar: {
    title: string;
    actions: { id: string; label: string }[];
  };
  contentType: string;
  /** 空白区域右键菜单命令（各插件注册） */
  contextMenu?: NavSideContextMenuItem[];
}

// ── 4. 框架绑定 (声明性质) ──
// export type ProseMirrorDoc = any;
// export type EChartsOption = any;
