/**
 * UI Primitives — 视图层与能力层的注册类型契约
 *
 * 按总纲 § 5.4 数据契约草图实现。L5 ViewDefinition 声明视图安装哪些
 * Capability + 视图独有交互项;Capability 跨视图复用。五大交互的命令
 * 字段必须 `command: string`(引用 CommandRegistry,函数实现走那里),
 * 不允许函数。
 *
 * 本文件仅类型,无运行时。
 */

// ── 1. 视图与能力 ──

/** 一个用户视图的定义 */
export interface ViewDefinition {
  viewId: string;                  // e.g. 'note.editor' / 'graph.family-tree'
  install?: CapabilityId[];        // 安装的能力列表
  // 视图独有项(不与其他视图共享)
  contextMenu?: ContextMenuItem[];
  toolbar?: ToolbarItem[];
  slash?: SlashItem[];
  handle?: HandleItem[];
  floatingToolbar?: FloatingToolbarItem[];
}

/** 一项能力的定义 */
export interface Capability {
  id: CapabilityId;                // e.g. 'capability.text-editing'

  // 1. UI 注册项(同 ViewDefinition 五大类)
  contextMenu?: ContextMenuItem[];
  toolbar?: ToolbarItem[];
  slash?: SlashItem[];
  handle?: HandleItem[];
  floatingToolbar?: FloatingToolbarItem[];
  keybindings?: KeyBinding[];

  // 2. Schema 贡献(如 ProseMirror 的 block/mark 定义)
  schema?: SchemaContribution;

  // 3. 数据转换(atom ↔ 该能力的内部表征)
  converters?: ConverterPair;

  // 4. 实例工厂(视图调用获得可挂载的实例)
  createInstance?: (host: HostElement, options: CapabilityOptions) => CapabilityInstance;

  // 5. 命令实现(被菜单项的 command: string 引用)
  commands?: Record<string, CommandHandler>;
}

/** Capability id 命名空间形如 `capability.<name>` */
export type CapabilityId = string;

// ── 2. 五大交互菜单项 ──

/** 控制菜单项启用条件——有限枚举(总纲 § 5.5 强约束 1) */
export type EnabledWhen = 'always' | 'has-selection' | 'is-editable';

/** 右键菜单项 */
export interface ContextMenuItem {
  id: string;
  label: string;
  group?: string;
  order?: number;
  icon?: string;
  command: string;                 // 字符串引用 CommandRegistry,不是函数
  enabledWhen?: EnabledWhen;
}

/** 工具栏项 */
export interface ToolbarItem {
  id: string;
  label: string;
  group?: string;
  order?: number;
  icon?: string;
  command: string;
  enabledWhen?: EnabledWhen;
}

/** Slash 命令项 */
export interface SlashItem {
  id: string;
  label: string;
  trigger: string;                 // 触发字符串,如 '/heading'
  group?: string;
  order?: number;
  icon?: string;
  command: string;
  enabledWhen?: EnabledWhen;
}

/** Handle(块拖拽手柄)菜单项 */
export interface HandleItem {
  id: string;
  label: string;
  group?: string;
  order?: number;
  icon?: string;
  command: string;
  enabledWhen?: EnabledWhen;
}

/** Floating Toolbar(选区悬浮工具栏)项 */
export interface FloatingToolbarItem {
  id: string;
  label: string;
  group?: string;
  order?: number;
  icon?: string;
  command: string;
  enabledWhen?: EnabledWhen;
}

// ── 3. 键绑定与命令 ──

/** 键盘快捷键绑定 */
export interface KeyBinding {
  key: string;                     // 如 'Mod-b' / 'Ctrl-Shift-l'
  command: string;
  when?: EnabledWhen;
}

/** 命令处理函数(签名待波次 2 CommandRegistry 落地时收紧) */
export type CommandHandler = (...args: unknown[]) => unknown | Promise<unknown>;

// ── 4. Capability 内部组件占位类型(波次 2 落地时收紧) ──

/** Schema 贡献(如 ProseMirror block/mark 定义) */
export type SchemaContribution = unknown;

/** Capability 实例挂载的宿主元素 */
export type HostElement = unknown;

/** Capability 创建实例时的选项 */
export type CapabilityOptions = unknown;

/** Capability 实例(view 销毁时被卸载) */
export type CapabilityInstance = unknown;

/** Atom ↔ 内部表征双向转换 */
export interface ConverterPair {
  toAtom: (data: unknown) => unknown;
  fromAtom: (atoms: unknown) => unknown;
}
