# noteTitle — Note 文档标题

> **类型**：Block（叶子，可升级为 Tab Container）
> **位置**：文档的第一个 Block，固定存在
> **状态**：基础实现完成

---

## 一、定义

noteTitle 是 NoteFile 的标题 Block。每个 NoteFile 有且仅有一个 noteTitle，始终位于文档最顶部。

它是用户对这篇笔记的第一印象——在笔记列表中显示的就是 noteTitle 的内容。

---

## 二、当前能力

| 能力 | 状态 | 说明 |
|------|------|------|
| 文本输入 | ✅ | 大字号（2.2em），单行/多行 |
| Bold / Italic / Code / Link | ✅ | 基础 Mark 格式化 |
| Placeholder | ✅ | 空时显示灰色 "Untitled" |
| NodeView | ✅ | 自定义渲染（is-empty class 控制 placeholder） |

---

## 三、不可做的操作

| 操作 | 状态 | 原因 |
|------|------|------|
| Handle（拖拽） | ❌ | 标题是固定首节点，不可移动 |
| 删除 | ❌ | 标题始终存在，删除文字后回到 placeholder 状态 |
| 转换类型（turnInto） | ❌ | 标题不能变成 paragraph 或其他 Block |
| 复制 | ❌ | 不支持 Block 级复制 |
| 缩进 | ❌ | 标题没有缩进概念 |
| 字体/大小自定义 | ❌ | 由主题统一控制，不允许逐文档自定义 |
| 颜色自定义 | ❌ | 由主题统一控制 |

---

## 四、Schema

```typescript
nodeSpec: {
  content: 'inline*',              // 支持文本 + inline node（如 mathInline）
  marks: 'bold italic code link',  // 支持的 Mark 子集
  defining: true,
}
```

**doc 的 content 表达式**：`'noteTitle? block+'`

noteTitle 是可选的——兼容没有标题的旧文档。新建文档时框架自动创建 noteTitle。

---

## 五、与 NoteFile 的关系

| 维度 | 说明 |
|------|------|
| **标题派生** | NoteFile 的 `title` 字段从 noteTitle 的文本内容自动派生 |
| **笔记列表** | NavSide Content List 显示的就是 noteTitle 的文本 |
| **搜索** | noteTitle 的文本参与全文搜索（atom_index） |
| **导入** | Markdown 导入时，`# H1` 映射为 noteTitle |
| **导出** | Markdown 导出时，noteTitle 输出为 `# H1` |

---

## 六、未来升级路径

### 6.1 图标（Emoji）— 近期

标题左侧显示文档图标（Emoji 或自定义图片），在笔记列表中也显示。

```
┌──────────────────────┐
│ 🎯 文档标题            │
└──────────────────────┘
```

实现方式：noteTitle 的 `attrs` 增加 `icon` 字段：

```typescript
attrs: {
  icon: { default: null },     // null = 无图标，string = emoji 或图片 URL
}
```

NodeView 在 contentDOM 前渲染图标。点击图标弹出 Emoji 选择器。

### 6.2 封面图 — 中期

标题上方的横幅图片，给文档视觉身份。

```
┌──────────────────────┐
│ [封面图 - 横幅]       │
│ 🎯 文档标题            │
└──────────────────────┘
```

实现方式：noteTitle **升级为 Tab Container**（动态升级路径）：

```typescript
tabs: [
  { id: 'cover', label: 'Cover', type: 'rendered' },   // 封面图面板
]
```

封面图是渲染型面板（不参与 ProseMirror 文档模型），由 NodeView 管理。

### 6.3 行内公式 — 近期

标题中的行内数学公式（如 `E = mc²`）。

实现方式：不需要改 noteTitle 本身。当 `mathInline` Block 注册后，noteTitle 的 `content: 'inline*'` 自动支持。

### 6.4 多语言标题 — 远期

标题的多语言版本（原文 + 翻译）。

实现方式：noteTitle **升级为 Tab Container**：

```typescript
tabs: [
  { id: 'original', label: '原文', type: 'editable' },
  { id: 'translated', label: '翻译', type: 'editable' },
]
```

---

## 七、BlockDef

```typescript
export const noteTitleBlock: BlockDef = {
  name: 'noteTitle',
  group: 'block',
  nodeSpec: {
    content: 'inline*',
    marks: 'bold italic code link',
    defining: true,
  },
  nodeView: noteTitleNodeView,
  capabilities: {
    turnInto: [],
    marks: ['bold', 'italic', 'code', 'link'],
    canDelete: false,
    canDuplicate: false,
    canDrag: false,
  },
  slashMenu: null,
};
```

---

## 八、设计原则

1. **固定存在**：noteTitle 不可删除、不可移动、不可转换。它是文档的身份标识
2. **样式由主题控制**：字体、大小、颜色不允许逐文档自定义，保证笔记列表的视觉一致性
3. **升级而非重写**：图标、封面图、多语言都是通过 Tab Container 升级路径实现，不需要改 noteTitle 的基础定义
4. **inline 扩展性**：`content: 'inline*'` 确保未来新增的 inline node（mathInline、mention 等）自动在标题中可用
