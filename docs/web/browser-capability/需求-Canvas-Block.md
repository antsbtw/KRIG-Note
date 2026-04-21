# 需求：NoteView Canvas Block

> 类型：功能增强  
> 创建日期：2026-04-21  
> 状态：已实现  
> 分支：`feature/noteview-enhancement`  
> 前置：Stage 1 ChatGPT 提取验证

---

## 一、背景

ChatGPT Canvas 是一个交互式编辑器，支持代码和文档两种模式。提取 ChatGPT 对话时，Canvas 内容通过 `/textdocs` API 获取，包含：

| 字段 | 说明 | 示例 |
|------|------|------|
| `title` | Canvas 标题 | "React Counter Component" |
| `textdoc_type` | 内容类型 | `code/react`, `code/python`, `document` |
| `content` | 完整内容 | 代码或 Markdown 文本 |

当前处理方式：代码类型渲染为 fenced code block，文档类型渲染为 Markdown 段落。缺少 Canvas 特有的视觉呈现——标题栏、语言标注、折叠/展开等。

## 二、参考：Claude Artifact Block

Claude 的 Artifact 在 NoteView 中已有专门的 block 实现（HTML Block），提供：
- 标题栏 + 类型标签
- iframe 沙箱渲染（HTML/SVG 内容）
- 打开/折叠交互

Canvas Block 应该借鉴这个模式，但针对 ChatGPT Canvas 的特点做调整。

## 三、期望行为

### 3.1 代码类型 Canvas (`code/*`)

渲染为带标题栏的代码面板：

```
┌─────────────────────────────────────────┐
│ 📄 React Counter Component    JSX  [Copy] │
├─────────────────────────────────────────┤
│ import { useState } from "react";       │
│ import { Button } from "@/components... │
│                                         │
│ export default function CounterApp() {  │
│   const [count, setCount] = useState(0);│
│   ...                                   │
└─────────────────────────────────────────┘
```

功能：
- 标题栏显示 Canvas 标题 + 语言类型
- 代码区域语法高亮（使用 NoteView 现有的代码高亮能力）
- 复制按钮
- 可选：折叠/展开（长代码默认折叠）

### 3.2 文档类型 Canvas (`document`)

渲染为带标题栏的文档面板：

```
┌─────────────────────────────────────────┐
│ 📄 项目需求文档              Document     │
├─────────────────────────────────────────┤
│ ## 项目概述                              │
│                                         │
│ 这是一个...                              │
│                                         │
│ ### 技术栈                               │
│ - React                                 │
│ - TypeScript                            │
└─────────────────────────────────────────┘
```

功能：
- 标题栏显示 Canvas 标题 + "Document" 标签
- 文档内容渲染为 Markdown（使用 NoteView 的渲染能力）
- 可选：折叠/展开

## 四、技术方案

### 4.1 方案变更：复用 codeBlock

经过讨论，Canvas Block 不再作为独立 block 类型实现，而是**扩展现有 codeBlock**，新增 `title` 属性：

```typescript
// CodeBlockContent 新增 title 字段
export interface CodeBlockContent {
  code: string;
  language: string;
  title?: string;      // 可选标题（如 ChatGPT Canvas 标题）
}
```

- `title` 不为空 → 显示标题栏（📄 Title + 语言标签）
- `title` 为空 → 现有 codeBlock 行为完全不变
- 所有 codeBlock 的编辑能力（CodeMirror、语法高亮、Copy、语言切换）天然继承

### 4.2 Markdown 语法

复用 fenced code block + `title="..."` 属性：

```markdown
```javascript title="React Counter Component"
import { useState } from "react";
...
```
```

result-parser 解析 `title="..."` 后传递给 codeBlock atom。

### 4.3 ProseMirror Node

现有 codeBlock 的 attrs 新增 `title`：

```typescript
codeBlock: {
  attrs: {
    language: { default: '' },
    title: { default: '' },     // ← 新增
  },
}
```

### 4.4 影响范围

| 模块 | 改动 |
|------|------|
| `src/shared/types/atom-types.ts` | `CodeBlockContent` 新增 `title?: string` |
| `src/shared/types/extraction-types.ts` | `ExtractedBlock` 新增 `codeTitle?: string` |
| `src/plugins/note/blocks/code-block.ts` | nodeSpec attrs 加 `title`，NodeView 加标题栏渲染 |
| `src/plugins/note/blocks/index.ts` | Slash 命令 `/canvas` |
| `src/plugins/note/converters/render-block-converters.ts` | codeBlockConverter round-trip `title` |
| `src/plugins/web-bridge/pipeline/result-parser.ts` | `collectCodeBlock` 解析 `title="..."` |
| `src/plugins/web-bridge/pipeline/content-to-atoms.ts` | 传递 `codeTitle` → `title` |
| `src/plugins/browser-capability/artifact/chatgpt-extract-turn.ts` | Canvas 输出 ``` + `title="..."` |
| `src/plugins/note/note.css` | `.code-block__title` 样式 |

## 五、验收标准

| # | 标准 |
|---|------|
| 1 | 代码类型 Canvas 渲染为带标题栏 + 语法高亮的代码面板 |
| 2 | 文档类型 Canvas 渲染为带标题栏的 Markdown 文档面板 |
| 3 | 标题栏显示 Canvas 标题和类型标签 |
| 4 | 代码面板支持复制按钮 |
| 5 | ChatGPT 提取的 Canvas 内容正确渲染为 Canvas Block |
| 6 | 不影响现有的 fenced code block 和 HTML Block 渲染 |
| 7 | Claude Artifact（HTML Block）行为不变 |
