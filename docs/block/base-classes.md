# Block 基类定义

> **文档类型**：架构契约
> **状态**：草案 v1 | 创建日期：2026-04-03
> **约束力**：所有 Block 实现必须遵循本文档定义的基类行为
>
> **本文档目的**：定义 TextBlock 和 RenderBlock 两个基类的完整行为和能力，作为所有 Block 开发的基础契约。

---

## 一、继承体系

```
Block（抽象基类）
  ├── TextBlock  — inline 流（文字 + inline 节点混排）
  └── RenderBlock — 独立运行容器（注册渲染器）
```

所有具体 Block 必须继承其中一个基类，不允许跳过基类直接实现。

---

## 二、Block 抽象基类

### 2.1 共享 Attrs

所有 Block（无论 TextBlock 还是 RenderBlock）共享以下 attrs：

```typescript
interface BlockBaseAttrs {
  // ── 排版 ──
  indent: number;              // 缩进级别（0-8），Tab/Shift-Tab 操控
  textIndent: boolean;         // 首行缩进（CSS text-indent: 2em）
  align: 'left' | 'center' | 'right' | 'justify';  // 文本对齐

  // ── 组合 ──
  groupType: string | null;    // 组合类型（'bullet'|'ordered'|'task'|'callout'|'quote'|'toggle'|'frame'|null）
  groupAttrs: Record<string, unknown> | null;  // 组合专属属性（emoji、color、checked、open 等）
}
```

### 2.2 共享操作

| 操作 | 入口 | 行为 |
|------|------|------|
| **Handle 显示** | 鼠标靠近 Block | 显示 + 和 ⠿ 按钮 |
| **+ 新建** | Handle + 按钮 | 在下方创建同类 Block（继承 groupType） |
| **拖拽移动** | Handle ⠿ 拖拽 | 移动 Block 位置 |
| **菜单** | Handle ⠿ 点击 | 弹出操作菜单（转换成 / 格式 / 删除） |
| **删除** | HandleMenu / ContextMenu / Backspace | 删除 Block |
| **Block Selection** | ESC | 选中当前 Block（蓝色高亮） |
| **多选** | Shift+↑↓ | 扩展选中范围 |
| **复制** | Cmd+C（选中状态） | Block 级复制 |
| **剪切** | Cmd+X（选中状态） | Block 级剪切 |
| **粘贴** | Cmd+V | Block 级粘贴 |
| **Undo/Redo** | Cmd+Z / Cmd+Shift+Z | 撤销/重做 |
| **缩进** | Tab | indent += 1 |
| **减少缩进** | Shift+Tab | indent -= 1（最小 0） |

### 2.3 共享组合能力

所有 Block 都可以通过设置 `groupType` 参与视觉容器：

- 相邻的、相同 `groupType` 的 Block 自动形成一组
- `groupType` 变化或为 null → 组断开
- 渲染层根据组内位置（first/middle/last/only）添加视觉效果

---

## 三、TextBlock 基类

### 3.1 定义

TextBlock 的内容是 **inline 流**——文字和 inline 节点可以自由混排。

```typescript
// ProseMirror nodeSpec
content: 'inline*'
```

### 3.2 inline 流的组成

| 类型 | 节点 | 说明 | 是否 atom |
|------|------|------|-----------|
| 文字 | text | 纯文字，可携带 marks | 否 |
| 软换行 | hardBreak | `<br>`，Shift+Enter 插入 | 否 |
| 行内公式 | mathInline | KaTeX 渲染，点击编辑 | 是 |
| 笔记链接 | noteLink | 📄 标签，点击导航 | 是 |

**未来可扩展的 inline 节点**（注册即可用，不修改 TextBlock）：

| 节点 | 说明 |
|------|------|
| mention | @提及（用户/文档/概念） |
| inlineImage | 行内小图（icon、缩略图） |
| date | 日期选择器 |
| emoji | 自定义 emoji 图片 |
| tag | 标签（知识图谱节点引用） |

### 3.3 Marks（文字格式化）

TextBlock 支持以下 marks：

| Mark | 快捷键 | 视觉 |
|------|--------|------|
| bold | Cmd+B | **加粗** |
| italic | Cmd+I | *斜体* |
| underline | Cmd+U | 下划线 |
| strike | Cmd+Shift+S | ~~删除线~~ |
| code | Cmd+E | `行内代码` |
| link | FloatingToolbar 🔗 | 蓝色下划线（Web URL / krig://note/） |
| textStyle | FloatingToolbar A | 文字颜色 |
| highlight | FloatingToolbar H | 背景高亮（5 色） |

### 3.4 专属 Attrs

TextBlock 在基类 attrs 之上增加：

```typescript
interface TextBlockAttrs extends BlockBaseAttrs {
  level: 1 | 2 | 3 | null;    // 标题级别（null = paragraph）
}
```

`level` 决定视觉变体：

| level | 视觉 | 字号 |
|-------|------|------|
| null | 普通段落 | 16px |
| 1 | H1 标题 | 30px, bold |
| 2 | H2 标题 | 24px, semibold |
| 3 | H3 标题 | 20px, semibold |

**noteTitle**：特殊的 TextBlock，`level = null` 但有 `isTitle: true` 标记，40px 字号，不可删除，文档固定首行。

### 3.5 键盘行为

| 按键 | 条件 | 行为 |
|------|------|------|
| **Enter** | 有内容 | 分裂为两个 TextBlock（继承 groupType/indent/textIndent/align） |
| **Enter** | 空行 + 有 groupType | 清除 groupType（脱离组） |
| **Enter** | 空行 + 无 groupType | 创建新空 TextBlock |
| **Shift+Enter** | 任何 | 插入 hardBreak（软换行，不创建新 Block） |
| **Backspace** | 行首 + 有 groupType | 清除 groupType + groupAttrs（变普通段落，保留文字） |
| **Backspace** | 行首 + 有 level | 清除 level（标题变段落） |
| **Backspace** | 行首 + 普通段落 | 与上一个 Block 合并 |
| **Backspace** | 空行 | 删除当前 Block |
| **Tab** | 任何 | indent += 1 |
| **Shift+Tab** | 任何 | indent -= 1 |
| **Cmd+Alt+1** | 任何 | level = 1（已是 H1 则清除） |
| **Cmd+Alt+2** | 任何 | level = 2 |
| **Cmd+Alt+3** | 任何 | level = 3 |

### 3.6 Markdown 输入规则

在行首输入以下模式 + 空格，自动转换：

| 输入 | 效果 |
|------|------|
| `# ` | level = 1 |
| `## ` | level = 2 |
| `### ` | level = 3 |
| `- ` 或 `* ` | groupType = 'bullet' |
| `1. ` | groupType = 'ordered' |
| `[] ` 或 `[ ] ` | groupType = 'task', checked = false |
| `[x] ` | groupType = 'task', checked = true |
| `> ` | groupType = 'quote' |

### 3.7 格式继承

新创建的 TextBlock（Enter 分裂产生）自动继承前一个 TextBlock 的：

- `textIndent`
- `align`
- `groupType` + `groupAttrs`
- `indent`

不继承 `level`（标题后回车创建普通段落）。

### 3.8 FloatingToolbar

选中文字后弹出：

```
[B] [I] [U] [S] [<>] | [H] [A] | [∑] [🔗]
```

| 按钮 | 功能 |
|------|------|
| B / I / U / S / <> | Mark 切换 |
| H | 背景高亮（5 色面板） |
| A | 文字颜色（6 色面板） |
| ∑ | 选中文字 → mathInline |
| 🔗 | 链接面板（Web URL / 笔记链接 / 移除链接） |

### 3.9 HandleMenu

| 菜单项 | 行为 |
|--------|------|
| 转换成 → | 文本 / H1 / H2 / H3 / 代码 / 引用 / 折叠列表 / 项目符号 / 有序列表 / 待办清单 |
| 格式 → | 首行缩进 / 左对齐 / 居中 / 右对齐 / 两端对齐 |
| Fold / Unfold | 标题专属（level ≠ null 时显示） |
| 删除 | 删除 Block |

### 3.10 ContextMenu（右键）

| 菜单项 | 条件 |
|--------|------|
| Cut / Copy / Paste | 始终 |
| 移除链接 | 光标在 link mark 上 |
| Delete / Indent / Outdent | Block 选中状态 |

---

## 四、RenderBlock 基类

### 4.1 定义

RenderBlock 是独立的运行容器，内容由注册的 **renderer** 决定。

```typescript
interface RenderBlockDef {
  type: string;                       // 'code' | 'image' | 'math' | 'video' | ...
  renderer: NodeViewFactory;          // ProseMirror NodeView 工厂
  attrs: Record<string, AttributeSpec>;  // 专属 attrs
  slashMenu?: SlashMenuDef | null;    // SlashMenu 注册
}
```

### 4.2 共享行为

RenderBlock 继承基类的所有共享操作（Handle、拖拽、删除、选中、组合等）。

**不继承的行为**：
- FloatingToolbar（RenderBlock 没有文字选中）
- Marks（RenderBlock 内容不是 inline 流）
- Markdown 输入规则（不在 RenderBlock 内触发）
- 文字合并（Backspace 不合并，而是删除整个 RenderBlock）

### 4.3 专属能力

| 能力 | 说明 |
|------|------|
| **自定义渲染** | NodeView 完全控制内容渲染 |
| **自定义交互** | stopEvent 拦截键盘/鼠标事件 |
| **内部状态** | renderer 自行管理状态（如 Mermaid 的 viewMode） |
| **Toolbar** | renderer 可以有自己的 toolbar（如 code 的语言选择 + 复制） |

### 4.4 键盘行为

| 按键 | 条件 | 行为 |
|------|------|------|
| **Enter** | 在 RenderBlock 外（光标在前/后） | 在上方/下方创建新 TextBlock |
| **Backspace** | RenderBlock 被选中 | 删除整个 RenderBlock |
| **Tab** | 任何 | indent += 1（整体缩进） |
| **Shift+Tab** | 任何 | indent -= 1 |
| **其他按键** | 在 RenderBlock 内部 | 由 renderer 的 stopEvent 决定是否拦截 |

### 4.5 注册示例

```typescript
// 代码块
registerRenderBlock({
  type: 'code',
  renderer: codeBlockRenderer,    // 代码编辑 + 语言选择 + 复制 + Mermaid 预览
  attrs: { language: { default: '' } },
  slashMenu: { label: 'Code Block', icon: '</>', keywords: ['code'] },
});

// 图片
registerRenderBlock({
  type: 'image',
  renderer: imageRenderer,        // 上传 + 显示 + 缩放 + caption
  attrs: { src: { default: null }, alt: { default: '' }, width: { default: null } },
  slashMenu: { label: 'Image', icon: '🖼', keywords: ['image'] },
});

// 数学公式
registerRenderBlock({
  type: 'math',
  renderer: mathBlockRenderer,    // LaTeX 输入 + KaTeX 渲染
  attrs: { latex: { default: '' } },
  slashMenu: { label: 'Math Block', icon: '∑', keywords: ['math'] },
});

// 未来：Python 运行环境
registerRenderBlock({
  type: 'python',
  renderer: pythonRuntime,        // 代码编辑 + 执行 + 输出
  attrs: { code: { default: '' }, output: { default: null } },
  slashMenu: { label: 'Python', icon: '🐍', keywords: ['python', 'run'] },
});
```

### 4.6 当前 RenderBlock 清单

| type | 渲染器 | attrs | 用途 |
|------|--------|-------|------|
| code | 代码编辑器 + 语言选择 + Mermaid | language | 代码/图表 |
| image | 图片显示 + 上传 + 缩放 | src, alt, width | 图片 |
| math | LaTeX 输入 + KaTeX 渲染 | latex | 数学公式 |
| video | URL 输入 + 播放器 | src, title, poster | 视频 |
| audio | 文件上传 + 播放器 | src, title, artist | 音频 |
| tweet | URL 输入 + 预览 | tweetUrl, author, text | 社交媒体 |

### 4.7 升级路径：Tab Container

任何 RenderBlock 未来可升级为 Tab Container：

```
RenderBlock type='video'
  →  TabContainer
       ├── Tab "视频"   → video renderer
       ├── Tab "字幕"   → subtitle editor
       └── Tab "笔记"   → text editor
```

---

## 五、TextBlock vs RenderBlock 对比

| | TextBlock | RenderBlock |
|---|---|---|
| **内容** | inline 流（文字 + inline 节点） | 由 renderer 决定 |
| **用户输入** | 直接打字 | 通过专属 UI |
| **Marks** | ✅ 支持（bold/italic/...） | ❌ 不支持 |
| **FloatingToolbar** | ✅ 选中文字后显示 | ❌ 不显示 |
| **Markdown 输入** | ✅ 自动转换 | ❌ 不适用 |
| **Handle** | ✅ | ✅ |
| **groupType** | ✅ 参与视觉容器 | ✅ 参与视觉容器 |
| **indent** | ✅ | ✅ |
| **拖拽** | ✅ | ✅ |
| **Block Selection** | ✅ | ✅ |
| **扩展方式** | 新增 inline 节点 / mark | 注册新 renderer |
| **回车行为** | 分裂为两个 TextBlock | 在外部创建新 TextBlock |

---

## 六、约束与规则

1. **所有 Block 必须继承基类**——不允许绕过基类直接创建 Block 类型
2. **基类行为不可覆盖**——Handle、拖拽、删除、选中等基类操作，子类不能修改
3. **扩展在子类侧**——TextBlock 通过新增 inline 节点/mark 扩展，RenderBlock 通过注册 renderer 扩展
4. **groupType 所有 Block 通用**——TextBlock 和 RenderBlock 都可以参与视觉容器
5. **回车 = 新 Block**——没有例外，所有 Block 类型都遵循

---

*本文档为基类契约。所有 Block 实现（包括未来新增的）必须遵循此定义。*
*修改基类行为需要全体评审。*
