# heading — 标题（H1-H3）

> **类型**：Block（叶子，可升级为 Tab Container）
> **位置**：文档中任意位置，内容的层级结构标记
> **状态**：基础实现完成

---

## 一、定义

heading 是文档的层级结构标记，用于组织内容的章节。KRIG Note 只支持 **H1-H3** 三级标题。

### 为什么只有 H1-H3

| 级别 | 用途 | 说明 |
|------|------|------|
| **H1** | 一级章节 | 文档的主要分块 |
| **H2** | 二级章节 | 章节内的子主题 |
| **H3** | 三级章节 | 细分内容 |

H4-H6 在实际使用中极少出现，且超过三级层次会让文档结构混乱。如果需要更深的层级，用 toggleHeading（折叠标题）或缩进来组织。

### heading vs noteTitle

| | noteTitle | heading |
|---|-----------|---------|
| 位置 | 文档第一个 Block，固定 | 文档中任意位置 |
| 数量 | 每文档一个 | 每文档多个 |
| 删除 | 不可删除 | 可删除 |
| 转换 | 不可转换 | 可转为 paragraph 等 |
| 用途 | 文档身份标识 | 内容层级结构 |

---

## 二、当前能力

| 能力 | 状态 | 说明 |
|------|------|------|
| 文本输入 | ✅ | H1-H3 三种级别，字号递减 |
| Mark 格式化 | ✅ | bold / italic / strike / underline / code / link |
| Handle | ✅ | 左侧拖拽手柄 |
| turnInto | ✅ | 可转为 paragraph / codeBlock / blockquote |
| 级别切换 | ✅ | H1 ↔ H2 ↔ H3 互转 |
| 缩进 | ✅ | Tab / Shift+Tab |
| 复制 | ✅ | Block 级复制 |
| 删除 | ✅ | Block 级删除 |
| 拖拽 | ✅ | 拖拽到其他位置 |

---

## 三、Schema

```typescript
nodeSpec: {
  content: 'inline*',
  group: 'block',
  attrs: {
    level: { default: 1 },      // 1 | 2 | 3
  },
  parseDOM: [
    { tag: 'h1', attrs: { level: 1 } },
    { tag: 'h2', attrs: { level: 2 } },
    { tag: 'h3', attrs: { level: 3 } },
  ],
  toDOM(node) { return [`h${node.attrs.level}`, 0]; },
}
```

### attrs 说明

- `level`：1-3，对应 H1-H3。不支持 4-6

---

## 四、Capabilities

```typescript
capabilities: {
  turnInto: [
    'paragraph',         // → 段落（取消标题格式）
    'codeBlock',         // → 代码块
    'blockquote',        // → 引用
    // 未来扩展：
    // 'toggleHeading',  // → 折叠标题（heading 变成 toggleHeading 的首子）
  ],
  marks: ['bold', 'italic', 'strike', 'underline', 'code', 'link'],
  canIndent: true,
  canDuplicate: true,
  canDelete: true,
  canDrag: true,
}
```

### 级别切换

heading 之间的级别切换不是 turnInto（类型不变），而是修改 `attrs.level`：

```
H1 → H2 → H3 → paragraph → H1（循环）
```

---

## 五、SlashMenu

heading 不作为单独一项注册，而是按级别分别注册：

| SlashMenu 项 | label | icon | group | 快捷键 |
|-------------|-------|------|-------|--------|
| heading1 | Heading 1 | H1 | basic | Cmd+Alt+1 |
| heading2 | Heading 2 | H2 | basic | Cmd+Alt+2 |
| heading3 | Heading 3 | H3 | basic | Cmd+Alt+3 |

输入 `/h1`、`/h2`、`/h3` 或 `/heading` 可搜索到。

---

## 六、交互行为

### 6.1 回车（Enter）

- 在标题末尾按 Enter → 创建新的空 **paragraph**（不是新 heading）
- 在标题中间按 Enter → 分裂为 heading + paragraph
- 在空标题按 Enter → heading 转为 paragraph（取消标题格式）

### 6.2 退格（Backspace）

- 在标题开头按 Backspace → heading 转为 paragraph
- 空标题按 Backspace → 转为 paragraph，再按删除

### 6.3 Markdown 快捷输入（InputRules）

| 输入 | 转换结果 |
|------|---------|
| `# ` + 空格 | → Heading 1 |
| `## ` + 空格 | → Heading 2 |
| `### ` + 空格 | → Heading 3 |

### 6.4 快捷键

| 快捷键 | 操作 |
|--------|------|
| Cmd+Alt+1 | 转为 / 切换到 H1 |
| Cmd+Alt+2 | 转为 / 切换到 H2 |
| Cmd+Alt+3 | 转为 / 切换到 H3 |
| Cmd+Alt+0 | 转为 paragraph（取消标题） |

---

## 七、视觉规格

| 级别 | 字号 | 字重 | 上间距 | 下间距 | 颜色 |
|------|------|------|--------|--------|------|
| H1 | 2em | 700 | 1em | 0.3em | #e8eaed |
| H2 | 1.5em | 600 | 0.8em | 0.3em | #e8eaed |
| H3 | 1.25em | 600 | 0.6em | 0.2em | #e8eaed |

由主题 CSS 控制，不由 attrs 自定义。

---

## 八、未来升级路径

### 8.1 大纲导航 — 近期

从文档中的所有 heading 自动生成大纲（Table of Contents），显示在 NavSide 或右侧面板。

```
文档内容              大纲
┌──────────────┐    ┌──────────┐
│ # 第一章      │    │ 第一章    │
│ 正文...       │    │  概述    │
│ ## 概述       │    │  详细    │
│ 正文...       │    │ 第二章    │
│ ## 详细       │    └──────────┘
│ # 第二章      │
└──────────────┘
```

### 8.2 折叠升级（toggleHeading）— 近期

heading 可以升级为 toggleHeading（折叠标题）：

```
普通 heading：
# 第一章

升级为 toggleHeading：
▸ 第一章          ← 点击折叠/展开
  正文内容...      ← 折叠时隐藏
```

这是 heading 到 Container 的升级路径，不是 Tab Container，而是 toggleHeading Container。

### 8.3 多语言标题 — 远期

和 paragraph 类似，heading 升级为 Tab Container：

```
[原文] [翻译]
## 机器学习概论
## Introduction to Machine Learning
```

### 8.4 锚点链接 — 近期

每个 heading 自动生成锚点 ID，支持文档内链接跳转：

```
[跳转到第一章](#heading-1)
```

---

## 九、与其他 Block 的关系

| 关系 | 说明 |
|------|------|
| **paragraph ↔ heading** | 最频繁的转换对（Enter 回退、Backspace 回退、快捷键切换） |
| **toggleHeading 的首子** | toggleHeading 容器的必填首子就是 heading |
| **大纲数据源** | 文档的所有 heading 构成大纲结构 |
| **Markdown 映射** | `#` / `##` / `###` 直接映射 |

---

## 十、BlockDef

```typescript
export const headingBlock: BlockDef = {
  name: 'heading',
  group: 'block',
  nodeSpec: {
    content: 'inline*',
    group: 'block',
    attrs: { level: { default: 1 } },
    parseDOM: [
      { tag: 'h1', attrs: { level: 1 } },
      { tag: 'h2', attrs: { level: 2 } },
      { tag: 'h3', attrs: { level: 3 } },
    ],
    toDOM(node) { return [`h${node.attrs.level}`, 0]; },
  },
  capabilities: {
    turnInto: ['paragraph', 'codeBlock', 'blockquote'],
    marks: ['bold', 'italic', 'strike', 'underline', 'code', 'link'],
    canIndent: true,
    canDuplicate: true,
    canDelete: true,
    canDrag: true,
  },
  slashMenu: null,  // 按级别单独注册（H1/H2/H3）
  shortcuts: {
    'Mod-Alt-1': setHeading(1),
    'Mod-Alt-2': setHeading(2),
    'Mod-Alt-3': setHeading(3),
  },
};
```

---

## 十一、设计原则

1. **只有三级**：H1-H3 足够表达文档层级。更深的层次用 toggleHeading 或缩进
2. **回车不延续**：标题末尾按回车创建的是 paragraph，不是新标题。标题是"标记"，不是"容器"
3. **升级到 toggleHeading**：需要折叠能力时，heading 升级为 toggleHeading 的首子，而非自身变成可折叠
4. **视觉由主题控制**：字号、字重、间距由 CSS 主题统一定义，不可逐标题自定义
5. **大纲友好**：heading 是文档大纲的数据源，命名和层级必须语义化
