# TextBlock — 文字流基类

> **文档类型**：基类契约
> **状态**：草案 v1 | 创建日期：2026-04-03
> **约束力**：所有文字类 Block 必须遵循本文档定义
> **继承**：Block 抽象基类（见 `base-classes.md`）

---

## 一、定义

TextBlock 的内容是 **inline 流**——文字和 inline 节点自由混排。用户直接在里面打字。

```typescript
content: 'inline*'
```

这是编辑器中最基础、最常用的 Block 类型。paragraph、heading、noteTitle 都是 TextBlock 的变体。

---

## 二、内容模型：inline 流

### 2.1 当前 inline 节点

| 节点 | 说明 | atom | 创建方式 |
|------|------|------|----------|
| text | 纯文字，可携带 marks | 否 | 直接打字 |
| hardBreak | 软换行 `<br>` | 否 | Shift+Enter |
| mathInline | 行内公式（KaTeX 渲染） | 是 | FloatingToolbar ∑ / SlashMenu |
| noteLink | 笔记链接（📄 标签） | 是 | FloatingToolbar 🔗 → 笔记链接 |

### 2.2 可扩展的 inline 节点（未来注册即可用）

| 节点 | 说明 |
|------|------|
| mention | @提及（用户/文档/概念） |
| inlineImage | 行内小图（icon、缩略图） |
| date | 日期选择器 |
| emoji | 自定义 emoji 图片 |
| tag | 标签（知识图谱节点引用） |

新增 inline 节点不需要修改 TextBlock——注册到 Schema 后自动在所有 TextBlock 中可用。

---

## 三、Marks（文字格式化）

| Mark | 快捷键 | 视觉 | 说明 |
|------|--------|------|------|
| bold | Cmd+B | **加粗** | |
| italic | Cmd+I | *斜体* | |
| underline | Cmd+U | 下划线 | |
| strike | Cmd+Shift+S | ~~删除线~~ | |
| code | Cmd+E | `行内代码` | 等宽字体 |
| link | FloatingToolbar 🔗 | 蓝色下划线 | Web URL 或 krig://note/ |
| textStyle | FloatingToolbar A | 文字颜色 | 6 色 |
| highlight | FloatingToolbar H | 背景高亮 | 5 色 |

---

## 四、专属 Attrs

TextBlock 在基类共享 attrs 之上增加：

```typescript
interface TextBlockAttrs extends BlockBaseAttrs {
  level: 1 | 2 | 3 | null;    // 标题级别（null = paragraph）
}
```

### 4.1 level 视觉变体

| level | 视觉 | 字号 | 字重 |
|-------|------|------|------|
| null | 普通段落 | 16px | normal |
| 1 | H1 标题 | 30px | 700 |
| 2 | H2 标题 | 24px | 600 |
| 3 | H3 标题 | 20px | 600 |

### 4.2 noteTitle

特殊的 TextBlock：

- `level = null`，`isTitle: true`
- 字号 40px，加粗
- 文档固定首行，不可删除，不可拖拽
- 空内容时显示 "Untitled" placeholder
- 内容变化自动同步到 NavSide 文件名

### 4.3 level + groupType 组合

| level | groupType | 视觉 |
|-------|-----------|------|
| null | null | 普通段落 |
| 1 | null | H1 标题 |
| 2 | null | H2 标题 |
| 3 | null | H3 标题 |
| null | 'bullet' | • 列表项 |
| null | 'ordered' | 1. 编号项 |
| null | 'task' | ☐ 待办项 |
| null | 'callout' | 💡 提示框行 |
| null | 'quote' | ┃ 引用行 |
| 1/2/3 | 'toggle' | ▾ 折叠标题 |
| null | 'toggle' | 折叠子内容 |
| null | 'frame' | 彩框内行 |

---

## 五、键盘行为

### 5.1 Enter（回车）

| 条件 | 行为 |
|------|------|
| 有内容，光标在中间 | 分裂为两个 TextBlock |
| 有内容，光标在末尾 | 创建新空 TextBlock |
| 空行 + 有 groupType | 清除 groupType + groupAttrs（脱离组） |
| 空行 + 有 level | 清除 level（标题变段落） |
| 空行 + 普通段落 | 创建新空 TextBlock |

新 Block 继承：groupType、groupAttrs、indent、textIndent、align。
不继承：level（标题后回车创建普通段落）。

### 5.2 Shift+Enter

插入 hardBreak（`<br>` 软换行），不创建新 Block。

### 5.3 Backspace（行首）

| 条件 | 行为 |
|------|------|
| 有 groupType | 清除 groupType + groupAttrs（变普通段落，保留文字） |
| 有 level | 清除 level（标题变段落，保留文字） |
| 普通段落 | 与上一个 Block 合并 |
| 空行 | 删除当前 Block |

### 5.4 Tab / Shift-Tab

```
Tab → indent += 1（最大 8）
Shift-Tab → indent -= 1（最小 0）
```

### 5.5 标题快捷键

```
Cmd+Alt+1 → level = 1（已是 H1 则清除 → paragraph）
Cmd+Alt+2 → level = 2
Cmd+Alt+3 → level = 3
```

---

## 六、Markdown 输入规则

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

---

## 七、格式继承

新创建的 TextBlock（Enter 产生）自动继承前一个 TextBlock 的：

| 属性 | 继承 |
|------|------|
| textIndent | ✅ |
| align | ✅ |
| groupType | ✅ |
| groupAttrs | ✅ |
| indent | ✅ |
| level | ❌（标题后回车 = 段落） |

---

## 八、FloatingToolbar

选中文字后弹出浮动工具栏：

```
[B] [I] [U] [S] [<>] | [H] [A] | [∑] [🔗]
```

| 按钮 | 功能 | 说明 |
|------|------|------|
| B | 加粗 | Cmd+B |
| I | 斜体 | Cmd+I |
| U | 下划线 | Cmd+U |
| S | 删除线 | Cmd+Shift+S |
| <> | 行内代码 | Cmd+E |
| H | 背景高亮 | 5 色面板 |
| A | 文字颜色 | 6 色面板 |
| ∑ | 行内公式 | 选中文字 → mathInline |
| 🔗 | 链接 | Web URL / 笔记链接 / 移除链接 |

---

## 九、HandleMenu

| 菜单项 | 行为 |
|--------|------|
| **转换成 →** | 文本 / H1 / H2 / H3 / 代码 / 引用 / 折叠列表 / 项目符号 / 有序列表 / 待办清单 |
| **格式 →** | 首行缩进（toggle）/ 左对齐 / 居中 / 右对齐 / 两端对齐 |
| **Fold/Unfold** | 标题专属（level ≠ null 时显示） |
| **删除** | 删除 Block |

---

## 十、ContextMenu（右键）

| 菜单项 | 条件 |
|--------|------|
| Cut / Copy / Paste | 始终显示 |
| 移除链接 | 光标在 link mark 上 |
| Delete / Indent / Outdent | Block 选中状态 |

---

## 十一、与知识图谱的关系

TextBlock 是知识图谱的基础数据单元（P3 原则）：

- 每个 TextBlock 可以被引用（noteLink 指向）
- 文字内容可被全文搜索
- groupType 关联关系成为图谱的边
- inline 节点（mathInline、noteLink、未来的 mention/tag）是节点间的连接点

---

*本文档为 TextBlock 基类契约。修改需全体评审。*
