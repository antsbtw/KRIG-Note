# TextBlock — 文字流基类

> **文档类型**：基类契约
> **状态**：v2 | 更新日期：2026-04-04
> **约束力**：所有文字类 Block 必须遵循本文档定义
> **继承**：Block 抽象基类（见 `base-classes.md`）

---

## 一、定义

TextBlock 的内容是 **inline 流**——文字和 inline 节点自由混排。用户直接在里面打字。

```typescript
content: 'inline*'
```

这是编辑器中最基础、最常用的 Block 类型。paragraph、heading、noteTitle、以及所有 groupType 变体（bullet、ordered、task、quote、callout、toggle、frame）都是 TextBlock 的 attrs 变体，**共享同一个 Schema 节点类型**。

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

```typescript
interface TextBlockAttrs {
  // 标题级别
  level: 1 | 2 | 3 | null;       // null = paragraph, 1/2/3 = H1/H2/H3
  isTitle: boolean;                // true = 文档标题（40px）

  // 排版
  indent: number;                  // 缩进层级（0-8，每级 24px）
  textIndent: boolean;             // 首行缩进 2em
  align: 'left' | 'center' | 'right' | 'justify';

  // groupType 系统
  groupType: string | null;        // 视觉容器类型
  groupAttrs: Record<string, unknown> | null;  // 容器专属数据

  // Heading 折叠
  open: boolean;                   // heading 折叠状态（level ≠ null 时生效）
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

### 4.3 groupType 变体

| groupType | 视觉 | groupAttrs |
|-----------|------|------------|
| null | 普通段落 | — |
| 'bullet' | • 列表项 | — |
| 'ordered' | 1. 编号项 | — |
| 'task' | ☐ 待办项 | `{ checked: boolean }` |
| 'callout' | 💡 提示框行 | `{ emoji: string }` |
| 'quote' | ┃ 引用行 | — |
| 'toggle' | ▾ 折叠列表 | `{ open: boolean }` |
| 'frame' | 彩框内行 | — |

### 4.4 groupType 的本质

groupType 不是独立容器节点，而是 **textBlock 的 attrs 变体**。多个连续的同 groupType textBlock 在视觉上组成一个"组"。

优点：
- 一种节点类型，一套操作逻辑
- 不需要容器嵌套的复杂处理
- 转换只是改 attrs，不改结构

---

## 五、groupType 嵌套

### 5.1 嵌套机制

通过 **indent + groupType 组合** 实现视觉嵌套。在一个 groupType 组内，可以通过 SlashMenu 或 Markdown 快捷输入切换到另一个 groupType，子级自动缩进。

```
1. 有序步骤一
2. 有序步骤二
   • 无序要点 A        ← indent=1, groupType='bullet'
   • 无序要点 B
3. 有序步骤三            ← indent=0, groupType='ordered'
```

### 5.2 groupType 栈（设计中）

为支持"空行回车退回上一级"，需要追踪嵌套层级：

```typescript
// 方案：用 indent 层级隐式推断父 groupType
// 空行回车时：
//   1. 清除当前 groupType
//   2. 查找 indent - 1 层级的最近 block
//   3. 如果它有 groupType，恢复为该 groupType 并设 indent -= 1
//   4. 否则变为普通段落（indent = 0）
```

示例交互：

```
1. 有序步骤一
2. 有序步骤二
   • 无序要点 A
   • 无序要点 B
   •                   ← 空行回车
3. 有序步骤三            ← 退回 ordered, indent=0

> 引用第一行
> 引用第二行
>   1. 嵌套编号一        ← indent=1, groupType='ordered'
>   2. 嵌套编号二
>   （空行回车）
> 引用继续               ← 退回 quote, indent=0
```

### 5.3 嵌套规则

| 规则 | 说明 |
|------|------|
| 任意 groupType 可嵌套任意 groupType | bullet 内可嵌套 ordered、quote 等 |
| 嵌套层级通过 indent 表示 | indent=0 是顶层，indent=1 是第一层嵌套 |
| 同组整体操作 | 同 groupType + 同 indent 的连续 blocks 视为一组 |
| 空行回车退出当前层级 | 退回父 groupType 或变普通段落 |

---

## 六、键盘行为

### 6.1 Enter（回车）

| 条件 | 行为 |
|------|------|
| 有内容，光标在中间 | 分裂为两个 TextBlock |
| 有内容，光标在末尾 | 创建新空 TextBlock |
| 空行 + 有 groupType | 清除 groupType + groupAttrs（脱离组）；未来：退回父级 |
| 空行 + 有 level | 清除 level（标题变段落） |
| 空行 + 普通段落 | 创建新空 TextBlock |

新 Block 继承：groupType、groupAttrs、indent、textIndent、align。
不继承：level（标题后回车创建普通段落）。

### 6.2 Shift+Enter

插入 hardBreak（`<br>` 软换行），不创建新 Block。

### 6.3 Backspace（行首）

| 条件 | 行为 |
|------|------|
| 有 groupType | 清除 groupType + groupAttrs（变普通段落，保留文字） |
| 有 level | 清除 level（标题变段落，保留文字） |
| 普通段落 | 与上一个 Block 合并 |
| 空行 | 删除当前 Block |

### 6.4 Tab / Shift-Tab

```
Tab → indent += 1（最大 8）
Shift-Tab → indent -= 1（最小 0）
```

有 groupType 时，indent 用 `margin-left`（整体包含装饰元素一起移动）。
无 groupType 时，indent 用 `padding-left`（纯文字缩进）。

### 6.5 快捷键

```
Cmd+Alt+0 → 转为文本（清除 level）
Cmd+Alt+1 → level = 1（已是 H1 则清除）
Cmd+Alt+2 → level = 2
Cmd+Alt+3 → level = 3
Cmd+Shift+T → 首行缩进 toggle
Cmd+. → Heading 折叠 toggle
```

---

## 七、Markdown 输入规则

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

## 八、格式继承

新创建的 TextBlock（Enter 产生）自动继承前一个 TextBlock 的：

| 属性 | 继承 |
|------|------|
| textIndent | ✅ |
| align | ✅ |
| groupType | ✅（仅 split 时，空行退出不继承） |
| groupAttrs | ✅（同上） |
| indent | ✅ |
| level | ❌（标题后回车 = 段落） |

---

## 九、FloatingToolbar

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

## 十、HandleMenu

| 菜单项 | 快捷键 | 行为 |
|--------|--------|------|
| **转换成 →** | | 文本(⌘⌥0) / H1(⌘⌥1) / H2(⌘⌥2) / H3(⌘⌥3) / 代码 / 引用 / 折叠列表 / 项目符号 / 有序列表 / 待办清单 / 提示框 |
| **格式 →** | | 首行缩进(⌘⇧T) / 左对齐 / 居中 / 右对齐 / 两端对齐 |
| **Fold/Unfold** | ⌘. | 标题专属（level ≠ null 时显示） |
| **删除** | Del | 删除 Block |

---

## 十一、ContextMenu（右键）

| 菜单项 | 条件 |
|--------|------|
| Cut / Copy / Paste | 始终显示 |
| 移除链接 | 光标在 link mark 上 |
| Delete / Indent / Outdent | Block 选中状态 |

右键 render block 时自动选中该 block，显示 block 级操作。

---

## 十二、Block Selection（多选）

| 操作 | 行为 |
|------|------|
| ESC | 选中光标所在 block（toggle） |
| Shift+↑/↓ | 扩展选中到相邻 block |
| Shift+点击 | 范围选中 |
| Tab / Shift+Tab | 批量缩进所有选中 blocks |
| Delete / Backspace | 批量删除 |
| Cmd+C / Cmd+X / Cmd+V | 批量复制/剪切/粘贴 |
| ↑/↓ | 切换选中的 block |
| ←/→ | 退出选中，光标到首/末 block |
| 拖拽手柄 | 整体移动选中的 blocks |

---

## 十三、与知识图谱的关系

TextBlock 是知识图谱的基础数据单元（P3 原则）：

- 每个 TextBlock 可以被引用（noteLink 指向）
- 文字内容可被全文搜索
- groupType 关联关系成为图谱的边
- inline 节点（mathInline、noteLink、未来的 mention/tag）是节点间的连接点

---

*本文档为 TextBlock 基类契约。修改需全体评审。*
