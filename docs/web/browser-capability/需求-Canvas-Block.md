# 需求：NoteView Canvas Block

> 类型：功能增强  
> 创建日期：2026-04-21  
> 状态：待开发  
> 建议分支：`feature/canvas-block`  
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

### 4.1 Atom 类型

```typescript
export interface CanvasBlockContent {
  title: string;           // Canvas 标题
  canvasType: string;      // 'code/react' | 'code/python' | 'document' | ...
  language?: string;       // 代码语言（从 canvasType 解析）
  content: string;         // 完整内容
  source?: 'chatgpt';     // 来源标识
}
```

### 4.2 Markdown 语法

扩展现有的 `!attach` / `!file` 模式，新增 Canvas 块级语法：

```markdown
!canvas[React Counter Component](code/react)
```jsx
import { useState } from "react";
...
```
!end-canvas
```

或者更简单的方式——复用 fenced code block + metadata：

```markdown
```jsx canvas="React Counter Component"
import { useState } from "react";
...
```
```

### 4.3 ProseMirror Node

```typescript
canvasBlock: {
  group: 'block',
  content: 'text*',
  attrs: {
    title: { default: '' },
    canvasType: { default: '' },
    language: { default: '' },
    collapsed: { default: false },
  },
  // ...
}
```

### 4.4 影响范围

| 模块 | 改动 |
|------|------|
| `src/shared/types/atom-types.ts` | 新增 `CanvasBlockContent` |
| `src/plugins/note/blocks/` | 新增 `canvas-block.ts` — NodeView |
| `src/plugins/note/blocks/index.ts` | 注册 canvasBlock |
| `src/plugins/note/converters/` | Atom <-> PMNode 转换 |
| `src/plugins/web-bridge/pipeline/result-parser.ts` | 识别 Canvas 语法 |
| `src/plugins/web-bridge/pipeline/content-to-atoms.ts` | 创建 canvasBlock atom |
| `chatgpt-extract-turn.ts` | Canvas 输出改用新语法 |
| `src/plugins/note/note.css` | Canvas block 样式 |

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
