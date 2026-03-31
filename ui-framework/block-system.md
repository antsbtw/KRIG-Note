# Block 系统 — 定义

> **前置**：本文档定义 NoteView 的 Block 注册制架构。
> 核心目标：新增一个 Block = 写一个文件 + 注册一次。

---

## 一、核心思想

### 1.1 Block + Container 二元模型

编辑器中只有两种东西：

- **Block（叶子节点）**：最小的独立内容单元（paragraph、heading、codeBlock、image...）
- **Container（容器节点）**：包含其他 Block 的组织节点（blockquote、toggleHeading、table...）

Container 继承 Block 的全部能力，额外增加子节点管理能力。

### 1.2 Block 注册制

框架不硬编码任何 Block 类型。所有 Block 通过 `BlockDef` 注册：

```
新增一个 Block = 写一个 BlockDef 对象 + 调用 blockRegistry.register()
```

框架自动完成：Schema 注册、NodeView 注册、Converter 注册、SlashMenu 生成、Plugin 挂载、Container Rule 注册。

### 1.3 Tab Container 动态升级

任何 Block 都可以从叶子升级为 Tab Container：

```
叶子 Block（1 个内容面板）：
┌──────────────┐
│   Content    │
└──────────────┘

Tab Container（2+ 个面板）：
┌──────────────────────────┐
│  [Tab A] [Tab B] [Tab C] │
├──────────────────────────┤
│   Tab A 面板 (可见)       │
│   Tab B 面板 (隐藏)       │
└──────────────────────────┘
```

三种模式（混合模式 C）：
- **始终叶子**：paragraph、heading — 不需要多视角
- **始终 Tab Container**：video — 天然就是多面板（播放器 + 元数据 + 字幕）
- **可动态升级**：image — 默认叶子，用户操作后可添加"AI 分析"、"标注"等面板

---

## 二、BlockDef 接口

```typescript
export interface BlockDef {
  // ── 身份 ──
  name: string;                      // 节点类型名（如 'paragraph', 'heading', 'videoPlaceholder'）
  group: 'block' | 'inline';        // 节点组

  // ── Schema ──
  nodeSpec: NodeSpec;                // ProseMirror NodeSpec 定义

  // ── 视图 ──
  nodeView?: NodeViewFactory;        // 自定义 NodeView（可选，简单块用默认渲染）

  // ── Tab Container 升级 ──
  tabs?: TabDefinition[] | null;     // null = 始终叶子；有值 = 支持 Tab 面板
  dynamicTabs?: boolean;             // true = 可动态添加/移除 Tab（如 image 扩展）

  // ── 数据层 ──
  converter: AtomConverter;          // Atom ↔ ProseMirror 转换器

  // ── 操作能力声明 ──
  capabilities: BlockCapabilities;

  // ── Block 专有操作 ──
  customActions?: ActionDef[];       // 只有这种 Block 才有的操作

  // ── SlashMenu ──
  slashMenu?: SlashMenuDef | null;   // null = 不出现在 SlashMenu

  // ── 快捷键 ──
  shortcuts?: Record<string, Command>;

  // ── 插件 ──
  plugin?: () => Plugin;             // ProseMirror Plugin（可选）

  // ── 容器规则 ──
  containerRule?: ContainerRule;     // 如果是 Container，定义约束

  // ── 授权 ──
  tier?: LicenseTier;                // 默认 'free'
}
```

---

## 三、操作能力声明（Capabilities）

### 3.1 BlockCapabilities

```typescript
export interface BlockCapabilities {
  // 转换能力：能转成哪些 Block
  turnInto?: string[];               // ['paragraph', 'heading', 'codeBlock', ...]

  // Mark 支持：FloatingToolbar 显示哪些格式按钮
  marks?: string[];                  // ['bold', 'italic', 'link', 'code', ...]

  // 通用操作
  canIndent?: boolean;               // 能否缩进
  canDuplicate?: boolean;            // 能否复制
  canDelete?: boolean;               // 能否删除（几乎所有 Block 都为 true）
  canColor?: boolean;                // 能否设置颜色

  // 拖拽
  canDrag?: boolean;                 // 能否拖拽移动
}
```

### 3.2 capabilities 驱动菜单

框架的菜单系统读取 Block 的 capabilities，动态生成菜单项：

```
SlashMenu        → BlockRegistry 全量 → "创建什么 Block"
FloatingToolbar  → 当前 Block.capabilities.marks → "文本格式化"
HandleMenu       → 当前 Block.capabilities + customActions → "对它做什么"
右键菜单         → capabilities + 剪贴板操作 → "对它做什么 + 复制粘贴"
```

**Block 不关心菜单长什么样、怎么触发。Block 只声明"我能做什么"。**

---

## 四、SlashMenu

### 4.1 数据源

SlashMenu 的数据来自**全局 Block 注册表**。SlashMenu 的本质是**创建新 Block**。

```
用户输入 /
  → 读取 BlockRegistry 中所有 slashMenu 不为 null 的 Block
  → 按 group 分组显示
  → 用户选择
  → 框架调用对应的创建/转换命令
```

### 4.2 SlashMenuDef

```typescript
export interface SlashMenuDef {
  label: string;                     // 显示名称（如 "Heading 1"）
  icon?: string;                     // 图标
  group: string;                     // 分组（如 'basic', 'layout', 'media', 'code'）
  keywords?: string[];               // 搜索关键词
  order?: number;                    // 组内排序
}
```

### 4.3 自动生成

```typescript
// 框架自动生成 SlashMenu 项，不需要手动维护列表
function generateSlashItems(): SlashMenuItem[] {
  return blockRegistry.getAll()
    .filter(b => b.slashMenu !== null && b.slashMenu !== undefined)
    .map(b => ({
      id: b.name,
      label: b.slashMenu!.label,
      icon: b.slashMenu!.icon,
      group: b.slashMenu!.group,
      keywords: b.slashMenu!.keywords,
      action: (view, from, to) => {
        // 删除 / 字符，执行创建/转换命令
      },
    }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
```

---

## 五、Block 专有操作（CustomActions）

### 5.1 ActionDef

```typescript
export interface ActionDef {
  id: string;                        // 操作 ID
  label: string;                     // 显示名称
  icon?: string;                     // 图标
  shortcut?: string;                 // 快捷键提示
  handler: (view: EditorView, pos: number) => boolean;

  // 出现在哪些菜单中
  showIn?: ('handleMenu' | 'contextMenu' | 'toolbar')[];
}
```

### 5.2 示例

```typescript
// Table Block 的专有操作
customActions: [
  { id: 'add-row', label: 'Add Row', handler: addTableRow, showIn: ['contextMenu'] },
  { id: 'add-col', label: 'Add Column', handler: addTableCol, showIn: ['contextMenu'] },
  { id: 'delete-row', label: 'Delete Row', handler: deleteTableRow, showIn: ['contextMenu'] },
],

// Heading Block 的专有操作
customActions: [
  { id: 'set-level-1', label: 'Heading 1', handler: setLevel(1), showIn: ['handleMenu'] },
  { id: 'set-level-2', label: 'Heading 2', handler: setLevel(2), showIn: ['handleMenu'] },
  { id: 'set-level-3', label: 'Heading 3', handler: setLevel(3), showIn: ['handleMenu'] },
],
```

---

## 六、Tab Container 基础设施

### 6.1 TabDefinition

```typescript
export interface TabDefinition {
  id: string;                        // Tab ID（如 'video', 'meta', 'subtitle'）
  label: string;                     // Tab 显示名称
  type: 'rendered' | 'editable';     // 渲染型 vs 编辑型
  defaultVisible?: boolean;          // 默认是否显示（默认 true）
}
```

### 6.2 框架提供的 Tab 基础设施

当 BlockDef 声明了 `tabs` 时，框架自动：

1. **Schema**：content 表达式改为包含 `tabPane`
2. **NodeView**：外层包裹 Tab 栏 + 内容区域
3. **Tab 栏**：渲染 Tab 按钮，处理切换
4. **面板管理**：渲染型面板由 NodeView 控制，编辑型面板由 ProseMirror contentDOM 管理

Block 插件只需要：
- 声明 tabs 列表
- 提供渲染型面板的 DOM 内容
- 编辑型面板的内容由 ProseMirror 自动管理

### 6.3 动态升级

`dynamicTabs: true` 的 Block 可以在运行时添加/移除 Tab：

```typescript
// Image Block 初始是叶子
const imageBlock: BlockDef = {
  name: 'image',
  tabs: null,              // 叶子
  dynamicTabs: true,       // 但支持动态升级
  customActions: [
    {
      id: 'add-analysis',
      label: 'Add AI Analysis',
      handler: (view, pos) => {
        // 将 image 升级为 Tab Container，添加 AI 分析面板
        upgradeToTabContainer(view, pos, [
          { id: 'image', label: 'Image', type: 'rendered' },
          { id: 'analysis', label: 'AI Analysis', type: 'editable' },
        ]);
        return true;
      },
      showIn: ['handleMenu'],
    },
  ],
};
```

---

## 七、Container 规则

### 7.1 ContainerRule

```typescript
export interface ContainerRule {
  requiredFirstChildType?: string;   // 必填首子类型（如 toggleHeading 要求 heading）
  convertTo?: string;                // 首子不兼容时转换为什么容器
}
```

### 7.2 容器约束引擎

框架的 `applyBlockReplace()` 统一处理容器约束：

```
Block 转换操作
  → 解析 BlockTarget（位置、父容器、是否为必填首子）
  → 检查容器规则
    → 兼容 → 直接替换
    → 不兼容 → 转容器类型 或 溶解容器
  → 执行 ProseMirror Transaction
```

Block 操作函数**不需要知道容器约束**。约束由框架的容器引擎统一处理（CLAUDE.md 不变量 §8：Block 操作稳定性）。

---

## 八、BlockRegistry

### 8.1 注册表 API

```typescript
class BlockRegistry {
  /** 注册一个 Block */
  register(block: BlockDef): void;

  /** 获取所有已注册的 Block */
  getAll(): BlockDef[];

  /** 获取指定 Block */
  get(name: string): BlockDef | undefined;

  /** 生成 ProseMirror Schema */
  buildSchema(): Schema;

  /** 生成 NodeView 映射 */
  buildNodeViews(): Record<string, NodeViewFactory>;

  /** 生成 Plugin 列表 */
  buildPlugins(): Plugin[];

  /** 生成 SlashMenu 项 */
  buildSlashItems(): SlashMenuItem[];

  /** 获取指定 Block 的 capabilities */
  getCapabilities(name: string): BlockCapabilities;

  /** 获取指定 Block 的 customActions */
  getCustomActions(name: string): ActionDef[];

  /** 获取容器规则表 */
  getContainerRules(): Record<string, ContainerRule>;

  /** 初始化所有 Converter */
  initConverters(): void;
}

export const blockRegistry = new BlockRegistry();
```

### 8.2 启动流程

```
应用启动
  → 插件注册 Block：blockRegistry.register(paragraphBlock)
  → 插件注册 Block：blockRegistry.register(headingBlock)
  → ...
  → 框架初始化：
      schema = blockRegistry.buildSchema()
      nodeViews = blockRegistry.buildNodeViews()
      plugins = blockRegistry.buildPlugins()
      slashItems = blockRegistry.buildSlashItems()
      blockRegistry.initConverters()
  → 创建 ProseMirror EditorState
  → 创建 EditorView
```

---

## 九、Block 模块目录结构

### 9.1 NoteView 插件目录

```
src/plugins/note/                    ← NoteView 插件（独立目录）
├── index.ts                         ← 插件入口（注册所有 Block + 创建编辑器）
├── registry.ts                      ← BlockRegistry 实现
│
├── blocks/                          ← 所有 Block 定义
│   ├── paragraph.ts                 ← 叶子 Block（单文件）
│   ├── heading.ts
│   ├── code-block.ts
│   ├── image.ts
│   ├── math-block.ts
│   ├── horizontal-rule.ts
│   │
│   ├── toggle-heading/              ← Container（目录，有 plugin）
│   │   ├── index.ts                 ← 导出 BlockDef
│   │   ├── view.ts                  ← NodeView
│   │   └── plugin.ts               ← 键盘交互
│   │
│   ├── toggle-list/
│   │   ├── index.ts
│   │   ├── view.ts
│   │   └── plugin.ts
│   │
│   ├── table/
│   │   ├── index.ts
│   │   ├── view.ts
│   │   └── commands.ts              ← 表格专有操作
│   │
│   ├── video/                       ← Tab Container
│   │   ├── index.ts
│   │   ├── view.ts                  ← 渲染型面板（播放器、元数据）
│   │   └── commands.ts              ← 视频专有操作
│   │
│   └── ...
│
├── shared/                          ← 共享基础设施
│   ├── tab-bar.ts                   ← Tab 栏 DOM 构造器
│   ├── tab-content.ts               ← Tab 内容管理
│   ├── tab-pane-view.ts             ← tabPane NodeView
│   └── container-shared.ts          ← Container 共享工具（collapse、lift、sink）
│
├── block-ops/                       ← Block 操作层
│   ├── turn-into.ts                 ← 统一 Block 转换命令工厂
│   ├── block-target.ts              ← BlockTarget 类型 + 解析器
│   └── container-policy.ts          ← 容器约束引擎
│
├── converters/                      ← Atom ↔ ProseMirror 转换
│   └── registry.ts                  ← ConverterRegistry（自动从 BlockDef 收集）
│
├── plugins/                         ← 全局 ProseMirror 插件
│   ├── block-selection.ts           ← 多块选中
│   ├── block-handle.ts              ← 拖拽手柄
│   ├── slash-command.ts             ← SlashMenu 触发
│   ├── placeholder.ts               ← 空块占位文本
│   ├── paste.ts                     ← 粘贴处理
│   └── link-click.ts               ← 链接点击
│
├── components/                      ← React UI 组件
│   ├── SlashMenu.tsx                ← Slash 命令菜单（从 BlockRegistry 自动生成）
│   ├── FloatingToolbar.tsx          ← 文本选中浮动工具栏
│   ├── HandleMenu.tsx               ← 左侧手柄菜单
│   └── NoteToolbar.tsx              ← 顶部工具栏
│
├── commands.ts                      ← 通用编辑命令（Mark + indent + flattenToParagraphs）
├── keymap.ts                        ← 快捷键映射（从 BlockDef.shortcuts 收集）
└── note.css                         ← 编辑器样式
```

### 9.2 Block 单文件 vs 目录

```
新 Block 是 Container 或有 Plugin？
  → YES → 目录：blocks/xxx/（index + view + plugin + commands）
  → NO  → 单文件：blocks/xxx.ts

Block 需要 Tab Container？
  → YES → 目录：blocks/xxx/（+ 渲染型面板代码）
  → NO  → 不影响
```

---

## 十、Block 注册示例

### 10.1 简单叶子 Block（paragraph）

```typescript
// blocks/paragraph.ts
export const paragraphBlock: BlockDef = {
  name: 'paragraph',
  group: 'block',

  nodeSpec: {
    content: 'inline*',
    attrs: { indent: { default: 0 }, textAlign: { default: null } },
    parseDOM: [{ tag: 'p' }],
    toDOM() { return ['p', 0]; },
  },

  converter: {
    atomType: 'paragraph',
    tiptapType: 'paragraph',
    atomToTiptap(atom) { /* ... */ },
    tiptapToAtom(node, parentId) { /* ... */ },
  },

  capabilities: {
    turnInto: ['heading', 'bulletList', 'orderedList', 'codeBlock', 'blockquote', 'toggleHeading', 'toggleList'],
    marks: ['bold', 'italic', 'strike', 'underline', 'code', 'link', 'highlight', 'textStyle'],
    canIndent: true,
    canDuplicate: true,
    canDelete: true,
    canColor: true,
    canDrag: true,
  },

  slashMenu: {
    label: 'Paragraph',
    icon: '¶',
    group: 'basic',
    order: 0,
  },

  shortcuts: {
    'Mod-Alt-0': turnIntoParagraph,
  },
};
```

### 10.2 Container Block（toggleHeading）

```typescript
// blocks/toggle-heading/index.ts
export const toggleHeadingBlock: BlockDef = {
  name: 'toggleHeading',
  group: 'block',

  nodeSpec: {
    content: 'heading block*',
    attrs: { open: { default: true } },
    // ...
  },

  nodeView: toggleHeadingNodeView,
  plugin: toggleHeadingPlugin,

  converter: toggleHeadingConverter,

  capabilities: {
    turnInto: ['paragraph', 'heading', 'toggleList'],
    marks: [],
    canIndent: true,
    canDuplicate: true,
    canDelete: true,
    canDrag: true,
  },

  containerRule: {
    requiredFirstChildType: 'heading',
    convertTo: 'toggleList',
  },

  slashMenu: {
    label: 'Toggle Heading',
    icon: '▸',
    group: 'toggle',
    order: 0,
  },

  shortcuts: {
    'Mod-Alt-7': turnIntoToggleHeading,
  },
};
```

### 10.3 Tab Container Block（video）

```typescript
// blocks/video/index.ts
export const videoBlock: BlockDef = {
  name: 'videoPlaceholder',
  group: 'block',

  nodeSpec: {
    content: 'tabPane+',
    attrs: { src: { default: null }, metadata: { default: '{}' } },
    // ...
  },

  nodeView: videoNodeView,

  tabs: [
    { id: 'video', label: 'Video', type: 'rendered' },
    { id: 'meta', label: 'Meta', type: 'rendered' },
    { id: 'subtitle', label: 'Subtitle', type: 'editable' },
  ],

  converter: videoConverter,

  capabilities: {
    turnInto: [],
    marks: [],
    canDuplicate: true,
    canDelete: true,
    canDrag: true,
  },

  customActions: [
    { id: 'download', label: 'Download Video', handler: downloadVideo, showIn: ['toolbar'] },
    { id: 'fullscreen', label: 'Fullscreen', handler: toggleFullscreen, showIn: ['toolbar'] },
  ],

  slashMenu: {
    label: 'Video',
    icon: '🎬',
    group: 'media',
    order: 0,
  },
};
```

---

## 十一、不变量

1. **Block 能力不变**：Block 放入任何 Container 中，视图和操作能力完全保留
2. **Container 能力不变**：Container 嵌入另一个 Container 中，能力完全保留
3. **整体移动**：Container 移动时必须整体移动（容器 + 全部子节点）
4. **Block 操作全局性**：同一个 Block 操作，无论从 SlashMenu、HandleMenu、快捷键调用，行为完全一致
5. **Block 操作稳定性**：Block 操作函数一旦测试通过，不得修改。容器层只能包装，不能侵入
6. **注册即生效**：新增 Block = 注册一个 BlockDef，框架自动完成所有集成
7. **菜单由 capabilities 驱动**：Block 不注册菜单，Block 声明能力，菜单系统动态生成
8. **Tab Container 是升级路径**：任何 Block 可以通过声明 tabs 升级为 Tab Container，框架提供基础设施

---

## 十二、与 mirro-desktop 的对比

| 维度 | mirro-desktop | KRIG-Note |
|------|--------------|-----------|
| 新增 Block 注册点 | **12 个文件** | **1 个 BlockDef** |
| SlashMenu | 手动维护 40+ 项 | 从 BlockRegistry 自动生成 |
| 菜单系统 | 各菜单独立维护项目列表 | 统一从 capabilities 派生 |
| Container 规则 | 集中在 CONTAINER_RULES | 声明在 BlockDef.containerRule |
| Tab Container | 共享基础设施 | 继承 + 声明式升级 |
| Converter | 注册制（已有） | 继承，集成到 BlockDef |
| Block 操作 | turnInto 工厂（已有） | 继承，集成到 BlockDef |
