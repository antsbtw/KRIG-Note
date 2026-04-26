---
title: KRIG Note 核心概念
graph_variant: knowledge
---

# 概念清单

本文档列出 KRIG Note 的核心架构概念，按"6 层模型 + View 类型 + 跨层概念"组织。
每个 `# heading` 是一个图谱节点，`[[id]]` 形成节点间的边。

---

# Application [[application]]

桌面应用本身。Electron 应用进程，承载所有窗口和原生菜单。

- 实现：`src/main.ts`
- 包含 [[application-menu]] 和 [[window]]

# ApplicationMenu [[application-menu]]

macOS 原生菜单栏，由 `Menu.setApplicationMenu()` 创建。

- 实现：`src/main/menu/registry.ts`
- 不在 [[window]] 内部渲染

# Window [[window]]

应用主窗口（BaseWindow）。默认 1400×900。

- 实现：`src/main/window/shell.ts`
- 容纳 [[shell]] 作为窗口骨架

# Shell [[shell]]

窗口内的**固定骨架**。所有 Workspace 共享同一套 Shell，不随切换变化。

- 包含 [[workspace-bar]]、[[nav-sidebar]]、[[workspace-area]]、[[overlays]]

# WorkspaceBar [[workspace-bar]]

顶部 28px 工作空间标签栏。

- 显示所有 [[workspace]] 的标签（含 × 关闭按钮）
- 内置 SidebarToggle / CreateButton

# NavSidebar [[nav-sidebar]]

左侧导航栏。默认 224px，可拖拽 / 折叠。

- 内部含 ModeBar（[[nav-mode]] 切换）
- 通过 `registerNavPanel()` 注册各插件 Panel

# WorkspaceArea [[workspace-area]]

[[shell]] 中央的内容区域，由活跃的 [[workspace]] 填充。

- 不是独立 WebContentsView，是逻辑矩形
- 由 `src/main/slot/layout.ts` 计算 bounds

# Overlays [[overlays]]

覆盖在 [[workspace-area]] 之上的浮层面板。

- 同 group 互斥
- 当前 KRIG-Note 暂无独立 Overlay，由各 [[view]] 内部渲染浮层

# Workspace [[workspace]]

独立的 KRIG Note 工作环境。每个 Workspace 完全隔离。

- 持有自己的 [[view]] 实例池
- 持有当前 [[layout-mode]]
- 实现：`src/main/workspace/manager.ts`
- 填充 [[workspace-area]]

# Slot [[slot]]

[[workspace]] 内的布局位置：Left Slot 或 Right Slot。

- 一个 Slot 同时只放一个 [[view]]
- 由 [[layout-mode]] 决定怎么分（单/双）
- 实现：`src/main/slot/layout.ts`

# View [[view]]

内容视图。最底层的内容单元，每个实例是独立的 `WebContentsView`。

- 由 [[view-type]] 决定具体类型
- 放在 [[slot]] 里
- View 间不直接通信，全部通过 [[ipc]] 路由

---

# ViewType [[view-type]]

L5 View 的类型标识：`'note' | 'ebook' | 'web' | 'thought' | 'graph'`。

- 定义 [[note-view]]、[[ebook-view]]、[[web-view]]、[[thought-view]]、[[graph-view]]

# NoteView [[note-view]]

ProseMirror 富文本笔记编辑器。

- ViewType: `note`
- 入口：`src/plugins/note/components/NoteView.tsx`
- 每 [[workspace]] 上限 2 个（左右对照）
- 通过 [[ipc]] 与 [[thought-view]]、[[ebook-view]]、[[web-view]] 协作

# EBookView [[ebook-view]]

电子书阅读器（PDF / EPUB / DjVu / CBZ）。

- ViewType: `ebook`
- 入口：`src/plugins/ebook/`
- 每 [[workspace]] 上限 2 个
- PDF/DjVu/CBZ 用 FixedPage（Canvas）；EPUB 用 Reflowable（HTML）
- 通过 [[ipc]] 把内容提取到 [[note-view]]，把高亮关联到 [[thought-view]]

# WebView [[web-view]]

Web 浏览器。加载任意 URL，包括 ChatGPT / Claude / Gemini 等 AI 服务。

- ViewType: `web`
- 入口：`src/plugins/web/components/`
- 每 [[workspace]] 上限 2 个
- AI 不是独立 View，是加载特定 URL 的 WebView
- 通过 [[ipc]] 把网页内容提取到 [[note-view]]

# ThoughtView [[thought-view]]

思考 / 批注面板。Thought 关联到 [[note-view]] block 或 [[ebook-view]] 高亮。

- ViewType: `thought`
- 入口：`src/plugins/thought/`
- 每 [[workspace]] 上限 1 个
- 通过 [[ipc]] 触发源锚点滚动（[[note-view]] / [[ebook-view]]）

# GraphView [[graph-view]]

知识图谱可视化。基于 Three.js + 自建 SVG 几何渲染管线。

- ViewType: `graph`
- 入口：`src/plugins/graph/`
- 每 [[workspace]] 上限 1 个
- 当前实现 KnowledgeEngine 变种；MindMap / BPMN 等延后

---

# LayoutMode [[layout-mode]]

[[slot]] 的划分方式。命名规则：`{leftView}+{rightView}` 或 `{view}-only`。

- 一等公民组合（11 个）：`note-only` / `note+thought` / `note+web` / `note+ebook` / `ebook-only` / `ebook+note` / `ebook+thought` / `ebook+web` / `web-only` / `web+web` / `web+note`
- 二等公民组合（6 个）：`note+note` / `note+graph` / `graph-only` / `thought-only` / `ebook+ebook` / `web+graph`
- 决定 [[workspace]] 当前显示哪些 [[view]]

# NavMode [[nav-mode]]

[[nav-sidebar]] 的工作模式：`'note' | 'ebook' | 'web' | 'ai' | 'graph'`。

- 影响 NavSidebar 显示的 Panel
- 切换 NavMode 通常伴随切换 [[layout-mode]]

# IPC [[ipc]]

View 间通信总线。所有跨 [[view]] 通信都经过 main 进程路由。

- main → 活跃 View：`view.webContents.send(...)`
- View → main：`ipcMain.on/handle`
- View → 同 [[workspace]] 另一 View：`viewAPI.sendToOtherSlot()`
- 命名约定：`note:` / `ebook:` / `web:` / `thought:` / `graph:` 前缀
- 统一定义：`src/shared/types.ts` 的 `IPC` 常量
