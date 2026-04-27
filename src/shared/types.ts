// ─── L3: View 基础类型 ───

/** View 的基础类型分类（插件注册） */
export type ViewType = 'note' | 'ebook' | 'web' | 'graph' | 'thought';

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
  navSideWidth: number | null;       // 每个 Workspace 独立的 NavSide 宽度，null = 使用默认值
  dividerRatio: number;
  activeNoteId: string | null;        // NoteView 当前打开的笔记 ID（left slot）
  rightActiveNoteId: string | null;   // Right slot NoteView 当前打开的笔记 ID
  expandedFolders: string[];          // NavSide 展开的文件夹 ID 列表
  activeBookId: string | null;        // EBookView 当前打开的电子书 ID
  ebookExpandedFolders: string[];     // 书架文件夹展开状态
  activeGraphId: string | null;       // GraphView 当前打开的图 ID
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

/** ViewType 的渲染器配置 */
export interface ViewTypeRendererConfig {
  devServerUrl?: string;           // Vite dev server URL（开发模式）
  htmlFile: string;                // 生产模式 HTML 文件名（相对 renderer 目录）
  prodDir: string;                 // 生产模式子目录名（如 'note_view'）
  webPreferences?: {
    webviewTag?: boolean;          // 是否启用 webview 标签
  };
}

/** WorkMode 注册 */
export interface WorkModeRegistration {
  id: string;
  viewType: ViewType;
  variant?: string;
  icon: string;
  label: string;
  order: number;
  hidden?: boolean;            // true = 不在 NavSide tab 中显示（仅作为 right slot 使用）
  onViewCreated?: (view: import('electron').WebContentsView, guestWebContents: import('electron').WebContents) => void;
}

/** NavSide 内容注册（按 WorkMode 驱动） */
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
  SLOT_ENSURE_RIGHT: 'slot:ensure-right', // 确保 Right Slot 打开（不 toggle）
  SLOT_CLOSE: 'slot:close',             // View 关闭自己所在的 slot
  SLOT_GET_SIDE: 'slot:get-side',       // View 查询自己在哪个 slot
  SLOT_DIVIDER_CHANGED: 'slot:divider-changed',
  SLOT_LOCK_GET: 'slot:lock-get',       // 查询位置锁状态
  SLOT_LOCK_SET: 'slot:lock-set',       // 切换位置锁（true=独立滚动，false=联动）
  SLOT_LOCK_CHANGED: 'slot:lock-changed', // 主进程 → View 广播锁状态变化

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
  NOTE_DUPLICATE: 'note:duplicate',
  NOTE_SAVE_LAST_VIEW: 'note:save-last-view',   // 保存上次阅读顶层 block 索引
  NOTE_SAVE_BOOKMARKS: 'note:save-bookmarks',   // 保存书签列表（全量替换）

  // NoteFile 编辑器操作
  NOTE_OPEN_IN_EDITOR: 'note:open-in-editor',
  NOTE_PENDING_OPEN: 'note:pending-open',    // NoteEditor ready 后拉取待打开的 noteId
  NOTE_DELETED: 'note:deleted',               // main → NoteView: 笔记已删除，编辑器需清除
  NOTE_TITLE_CHANGED: 'note:title-changed',  // NavSide → NoteView: 文件名变更同步到 noteTitle

  // Folder 操作
  FOLDER_CREATE: 'folder:create',
  FOLDER_RENAME: 'folder:rename',
  FOLDER_DELETE: 'folder:delete',
  FOLDER_MOVE: 'folder:move',
  FOLDER_LIST: 'folder:list',
  FOLDER_DUPLICATE: 'folder:duplicate',

  // Workspace ↔ View 状态同步
  SET_ACTIVE_NOTE: 'workspace:set-active-note',            // NoteView → main: 报告当前打开的笔记
  SET_EXPANDED_FOLDERS: 'workspace:set-expanded-folders',  // NavSide → main: 保存展开的文件夹
  RESTORE_WORKSPACE_STATE: 'workspace:restore-state',      // main → NavSide/NoteView: 切换 Workspace 时恢复状态

  // 测试文档
  LOAD_TEST_DOC: 'note:load-test-doc',

  // SurrealDB 状态
  DB_READY: 'db:ready',
  IS_DB_READY: 'db:is-ready',

  // 文件对话框
  FILE_SAVE_DIALOG: 'file:save-dialog',
  FILE_OPEN_DIALOG: 'file:open-dialog',

  // 学习模块
  LEARNING_LOOKUP: 'learning:lookup',
  LEARNING_TRANSLATE: 'learning:translate',
  LEARNING_TTS: 'learning:tts',
  LEARNING_VOCAB_ADD: 'learning:vocab-add',
  LEARNING_VOCAB_REMOVE: 'learning:vocab-remove',
  LEARNING_VOCAB_LIST: 'learning:vocab-list',
  LEARNING_VOCAB_CHANGED: 'learning:vocab-changed',

  // 媒体操作
  MEDIA_DOWNLOAD: 'media:download',              // 下载远程媒体到本地
  MEDIA_PUT_BASE64: 'media:put-base64',          // 将 base64/data URL 存入 media store，返回 media://... URL
  MEDIA_PUT_FILE: 'media:put-file',              // 将本地文件路径复制到 media store，返回 media://... URL
  MEDIA_RESOLVE_PATH: 'media:resolve-path',      // 将 media:// URL 解析为本地磁盘路径（给 shell.openPath 用）
  MEDIA_OPEN_EXTERNAL: 'media:open-external',    // 用系统浏览器打开 URL
  MEDIA_OPEN_PATH: 'media:open-path',            // 用系统默认程序打开本地文件（shell.openPath）
  SHOW_ITEM_IN_FOLDER: 'media:show-in-folder',   // 在 Finder 中显示文件

  // Tweet 数据获取
  TWEET_FETCH_DATA: 'tweet:fetch-data',           // 获取结构化元数据
  TWEET_FETCH_OEMBED: 'tweet:fetch-oembed',       // 获取 oEmbed HTML

  // YouTube 字幕
  YOUTUBE_TRANSCRIPT: 'youtube:fetch-transcript',  // 获取 YouTube 字幕

  // NavSide 注册制
  NAVSIDE_GET_REGISTRATION: 'navside:get-registration',
  NAVSIDE_EXECUTE_ACTION: 'navside:execute-action',

  // eBook 书架（NavSide 用）
  EBOOK_BOOKSHELF_LIST: 'ebook:bookshelf-list',
  EBOOK_PICK_FILE: 'ebook:pick-file',              // 弹文件对话框，返回路径
  EBOOK_BOOKSHELF_ADD: 'ebook:bookshelf-add',       // 按指定模式（managed/link）导入
  EBOOK_BOOKSHELF_OPEN: 'ebook:bookshelf-open',
  EBOOK_BOOKSHELF_REMOVE: 'ebook:bookshelf-remove',
  EBOOK_BOOKSHELF_RENAME: 'ebook:bookshelf-rename',
  EBOOK_BOOKSHELF_MOVE: 'ebook:bookshelf-move',
  EBOOK_BOOKSHELF_CHANGED: 'ebook:bookshelf-changed',

  // eBook 文件夹
  EBOOK_FOLDER_CREATE: 'ebook:folder-create',
  EBOOK_FOLDER_RENAME: 'ebook:folder-rename',
  EBOOK_FOLDER_DELETE: 'ebook:folder-delete',
  EBOOK_FOLDER_MOVE: 'ebook:folder-move',
  EBOOK_FOLDER_LIST: 'ebook:folder-list',

  // eBook 数据传输（EBookView 用）
  EBOOK_GET_DATA: 'ebook:get-data',
  EBOOK_LOADED: 'ebook:loaded',
  EBOOK_CLOSE: 'ebook:close',

  // eBook 书签（PDF 页码）
  EBOOK_BOOKMARK_TOGGLE: 'ebook:bookmark-toggle',
  EBOOK_BOOKMARK_LIST: 'ebook:bookmark-list',
  // eBook 书签（EPUB CFI）
  EBOOK_CFI_BOOKMARK_ADD: 'ebook:cfi-bookmark-add',
  EBOOK_CFI_BOOKMARK_REMOVE: 'ebook:cfi-bookmark-remove',
  EBOOK_CFI_BOOKMARK_LIST: 'ebook:cfi-bookmark-list',

  // eBook 标注
  EBOOK_ANNOTATION_LIST: 'ebook:annotation-list',
  EBOOK_ANNOTATION_ADD: 'ebook:annotation-add',
  EBOOK_ANNOTATION_REMOVE: 'ebook:annotation-remove',

  // eBook Workspace 状态同步
  EBOOK_SET_ACTIVE_BOOK: 'ebook:set-active-book',
  EBOOK_SAVE_PROGRESS: 'ebook:save-progress',
  EBOOK_RESTORE: 'ebook:restore',
  EBOOK_SET_EXPANDED_FOLDERS: 'ebook:set-expanded-folders',

  // Web 书签
  WEB_BOOKMARK_LIST: 'web:bookmark-list',
  WEB_BOOKMARK_ADD: 'web:bookmark-add',
  WEB_BOOKMARK_REMOVE: 'web:bookmark-remove',
  WEB_BOOKMARK_UPDATE: 'web:bookmark-update',
  WEB_BOOKMARK_MOVE: 'web:bookmark-move',
  WEB_BOOKMARK_CHANGED: 'web:bookmark-changed',     // 主进程广播：书签 / 文件夹列表变更（NavSide WebPanel 监听）

  // Web 书签文件夹
  WEB_FOLDER_CREATE: 'web:folder-create',
  WEB_FOLDER_RENAME: 'web:folder-rename',
  WEB_FOLDER_DELETE: 'web:folder-delete',
  WEB_FOLDER_LIST: 'web:folder-list',
  WEB_FOLDER_MOVE: 'web:folder-move',

  // Web 浏览历史
  WEB_HISTORY_ADD: 'web:history-add',
  WEB_HISTORY_LIST: 'web:history-list',
  WEB_HISTORY_CLEAR: 'web:history-clear',

  // PDF Extraction (Platform)
  EXTRACTION_OPEN: 'extraction:open',              // 打开 ExtractionView + 上传当前 PDF
  EXTRACTION_IMPORT: 'extraction:import',           // 导入 JSON 数据 → 创建文件夹+Note → 切换到 NoteView

  // Thought 操作
  THOUGHT_CREATE: 'thought:create',
  THOUGHT_SAVE: 'thought:save',
  THOUGHT_LOAD: 'thought:load',
  THOUGHT_DELETE: 'thought:delete',
  THOUGHT_LIST_BY_NOTE: 'thought:list-by-note',
  THOUGHT_RELATE: 'thought:relate',
  THOUGHT_UNRELATE: 'thought:unrelate',

  // Graph (L5)
  GRAPH_CREATE: 'graph:create',
  GRAPH_LIST: 'graph:list',
  GRAPH_LOAD: 'graph:load',
  GRAPH_RENAME: 'graph:rename',
  GRAPH_DELETE: 'graph:delete',
  GRAPH_LIST_CHANGED: 'graph:list-changed',  // main → renderer 广播
  GRAPH_SET_ACTIVE: 'graph:set-active',      // navside → main：设置当前 workspace 的 activeGraphId
  GRAPH_ACTIVE_CHANGED: 'graph:active-changed',  // main → renderer：activeGraphId 变化（GraphView/NavSide 监听）
  GRAPH_MOVE_TO_FOLDER: 'graph:move-to-folder',  // v1.4: 把图移动到指定 folder（null = 根）
  GRAPH_SET_ACTIVE_LAYOUT: 'graph:set-active-layout',  // v1.4 graph-import: 切换图谱当前布局算法
  // Graph Folder (v1.4 NavSide 重构)
  GRAPH_FOLDER_LIST: 'graph-folder:list',
  GRAPH_FOLDER_CREATE: 'graph-folder:create',
  GRAPH_FOLDER_RENAME: 'graph-folder:rename',
  GRAPH_FOLDER_DELETE: 'graph-folder:delete',
  GRAPH_FOLDER_MOVE: 'graph-folder:move',
  GRAPH_FOLDER_LIST_CHANGED: 'graph-folder:list-changed',  // main → renderer 广播
  // ── v1.4 graph-import：四态数据模型 IPC ──
  GRAPH_LOAD_FULL: 'graph:load-full',                            // GraphView → main：加载图谱全部数据（geometries + intensions + presentations）
  GRAPH_GEOMETRY_CREATE: 'graph:geometry-create',
  GRAPH_GEOMETRY_DELETE: 'graph:geometry-delete',
  GRAPH_INTENSION_LIST: 'graph:intension-list',
  GRAPH_INTENSION_CREATE: 'graph:intension-create',
  GRAPH_INTENSION_UPDATE: 'graph:intension-update',
  GRAPH_INTENSION_DELETE: 'graph:intension-delete',
  GRAPH_INTENSION_CREATE_BULK: 'graph:intension-create-bulk',
  GRAPH_PRESENTATION_LIST: 'graph:presentation-list',
  GRAPH_PRESENTATION_SET: 'graph:presentation-set',
  GRAPH_PRESENTATION_SET_BULK: 'graph:presentation-set-bulk',
  GRAPH_PRESENTATION_DELETE: 'graph:presentation-delete',
  GRAPH_PRESENTATION_CLEAR_LAYOUT: 'graph:presentation-clear-layout',  // 清空指定 layout 所有 atom
  GRAPH_PRESENTATION_CHANGED: 'graph:presentation-changed',           // main → renderer 广播
  GRAPH_IMPORT_FROM_FILE: 'graph:import-from-file',                    // D11 实施
  GRAPH_SUBSTANCE_LIST: 'graph:substance-list',                        // 列出所有可用 substance（v1.5 详情面板用）
  GRAPH_SUBSTANCE_GET: 'graph:substance-get',

  // Web Translate
  WEB_TRANSLATE_FETCH_ELEMENT_JS: 'web-translate:fetch-element-js',

  // AI Workflow
  AI_ASK: 'ai:ask',                   // renderer → main：发送 AI 提问（Orchestrator 用后台 webview）
  AI_ASK_VISIBLE: 'ai:ask-visible',   // renderer → main：发送 AI 提问（用户可见，Right Slot WebView）
  AI_STATUS: 'ai:status',             // renderer → main：查询后台 AI 状态
  AI_NAVIGATE: 'ai:navigate',         // main → web renderer：导航到 AI 服务
  AI_INJECT_AND_SEND: 'ai:inject-and-send', // main → web renderer：注入 SSE + 粘贴 + 发送
  AI_RESPONSE_CAPTURED: 'ai:response-captured', // web renderer → main：SSE 拦截到回复
  AI_EXTRACT_DEBUG: 'ai:extract-debug',         // renderer → main：调试用，解析 Markdown 并返回统计
  AI_PARSE_MARKDOWN: 'ai:parse-markdown',       // renderer → main：解析 Markdown → Atom[]
  AI_EXTRACTION_CACHE_WRITE: 'ai:extraction-cache-write', // renderer → main：写入 AI 提取调试缓存文件
  MD_TO_PM_NODES: 'md:to-pm-nodes',             // renderer → main：Markdown 字符串 → ProseMirror node JSON 数组（smart paste 用）
  AI_READ_CLIPBOARD: 'ai:read-clipboard',       // renderer → main：读取系统剪贴板文本
  WB_CDP_START: 'wb:cdp-start',                 // renderer → main：启动 CDP 拦截器（调试用）
  WB_CDP_STOP: 'wb:cdp-stop',                   // renderer → main：停止 CDP 拦截器
  WB_CDP_GET_RESPONSES: 'wb:cdp-get-responses', // renderer → main：获取已捕获的响应
  WB_CDP_FIND_RESPONSE: 'wb:cdp-find-response', // renderer → main：按 URL substring 取匹配响应的完整 body（ChatGPT 提取用）
  WB_SEND_MOUSE: 'wb:send-mouse',               // renderer → main：向 guest webContents 合成鼠标事件（CDP Input.dispatchMouseEvent）
  WB_SEND_KEY: 'wb:send-key',                   // renderer → main：向 guest webContents 合成键盘事件（CDP Input.dispatchKeyEvent）
  WB_READ_CLIPBOARD_IMAGE: 'wb:read-clipboard-image', // renderer → main：读剪贴板图片（PNG dataURL）— Claude Artifact 复制的是渲染图像
  WB_CAPTURE_DOWNLOAD_ONCE: 'wb:capture-download-once', // renderer → main：一次性拦截下次 download，返回文件内容（Artifact "Download file" 提取源码用）
  WB_FETCH_BINARY: 'wb:fetch-binary',                 // renderer → main：main 进程 fetch URL（绕过 CORS / 页面 CSP），返回 base64 + mime（Gemini Imagen 图像下载用）
  WB_CAPTURE_ISOLATED_SEGMENT: 'wb:capture-isolated-segment', // renderer → main：隐藏窗口加载 Claude isolated-segment 页面并截图内部可见 mcp iframe
  WB_CAPTURE_GUEST_RECTS: 'wb:capture-guest-rects', // renderer → main：对当前 sender 对应的 guest webContents 按矩形截图
  BROWSER_CAPABILITY_DOWNLOAD_CLAUDE_ARTIFACTS: 'browser-capability:download-claude-artifacts', // renderer → main：手动触发当前 Claude 页可下载 artifact 的自动下载
  BROWSER_CAPABILITY_DEBUG_LOG: 'browser-capability:debug-log', // renderer → main：写入 browser-capability 调试日志
  BROWSER_CAPABILITY_EXTRACT_TURN: 'browser-capability:extract-turn', // renderer → main：从 conversation 数据提取单条 turn（含 artifact 内容）
  BROWSER_CAPABILITY_EXTRACT_FULL: 'browser-capability:extract-full', // renderer → main：从 conversation 数据提取完整对话
  BROWSER_CAPABILITY_PROBE_CONVERSATION: 'browser-capability:probe-conversation', // renderer → main：强制重新 fetch Claude conversation API 刷新 conversation.json

  // yt-dlp
  YTDLP_CHECK_STATUS: 'ytdlp:check-status',
  YTDLP_INSTALL: 'ytdlp:install',
  YTDLP_DOWNLOAD: 'ytdlp:download',
  YTDLP_GET_INFO: 'ytdlp:get-info',
  YTDLP_PROGRESS: 'ytdlp:progress',               // main → renderer 进度事件
  YTDLP_SAVE_SUBTITLE: 'ytdlp:save-subtitle',     // 保存翻译字幕为 .srt

  // Backup/Restore
  BACKUP_CREATE: 'backup:create',
  BACKUP_RESTORE: 'backup:restore',

  // 全局进度覆盖层（长耗时任务：备份/恢复/重置等）
  PROGRESS_START: 'progress:start',    // main → shell: 显示进度覆盖层
  PROGRESS_UPDATE: 'progress:update',  // main → shell: 更新阶段/百分比
  PROGRESS_DONE: 'progress:done',      // main → shell: 关闭覆盖层
} as const;

// 进度事件负载
export interface ProgressStartPayload {
  taskId: string;           // 唯一任务 ID
  title: string;            // 标题（如「数据备份中」）
  message?: string;         // 初始消息
  indeterminate?: boolean;  // true = 不确定进度条；false = 有 current/total
}
export interface ProgressUpdatePayload {
  taskId: string;
  message?: string;         // 当前阶段文字（如「3/5 复制媒体文件」）
  current?: number;         // 已完成量
  total?: number;           // 总量
}
export interface ProgressDonePayload {
  taskId: string;
  success: boolean;
  message?: string;         // 完成提示（成功或错误）
}
