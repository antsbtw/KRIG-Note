---
title: KRIG Note 核心概念
graph_variant: knowledge
dimension: 2
active_layout: force
---

# 概念清单

KRIG Note 的核心架构概念，按 6 层模型 + View 类型 + 跨层概念 + 集群（Surface）组织。
每个 `# heading` 是一个图谱节点；`- predicate :: value` 是描述属性；
`- contains :: [[id]]` 是包含关系（自动生成 Line 几何体）。

---

# Application [[application]]

> 桌面应用本身。Electron 应用进程，承载所有窗口和原生菜单。

- substance :: krig-layer
- type :: layer
- layer-id :: L0
- implementation :: src/main.ts
- contains :: [[application-menu]]
- contains :: [[window]]

# ApplicationMenu [[application-menu]]

> macOS 原生菜单栏，由 Menu.setApplicationMenu() 创建。

- substance :: krig-concept
- type :: concept
- implementation :: src/main/menu/registry.ts

# Window [[window]]

> 应用主窗口（BaseWindow）。默认 1400×900。

- substance :: krig-layer
- type :: layer
- layer-id :: L1
- implementation :: src/main/window/shell.ts
- contains :: [[shell]]

# Shell [[shell]]

> 窗口内的固定骨架。所有 Workspace 共享同一套 Shell，不随切换变化。

- substance :: krig-layer
- type :: layer
- layer-id :: L2
- contains :: [[workspace-bar]]
- contains :: [[nav-sidebar]]
- contains :: [[workspace-area]]
- contains :: [[overlays]]

# WorkspaceBar [[workspace-bar]]

> 顶部 28px 工作空间标签栏。

- substance :: krig-shell-component
- type :: shell-component
- height :: 28

# NavSidebar [[nav-sidebar]]

> 左侧导航栏。默认 224px，可拖拽 / 折叠。

- substance :: krig-shell-component
- type :: shell-component
- default-width :: 224

# WorkspaceArea [[workspace-area]]

> Shell 中央的内容区域，由活跃的 Workspace 填充。

- substance :: krig-shell-component
- type :: shell-component
- contains :: [[workspace]]

# Overlays [[overlays]]

> 覆盖在 WorkspaceArea 之上的浮层面板。

- substance :: krig-shell-component
- type :: shell-component

# Workspace [[workspace]]

> 独立的 KRIG Note 工作环境。每个 Workspace 完全隔离。

- substance :: krig-layer
- type :: layer
- layer-id :: L3
- implementation :: src/main/workspace/manager.ts
- contains :: [[slot]]

# Slot [[slot]]

> Workspace 内的布局位置：Left Slot 或 Right Slot。

- substance :: krig-layer
- type :: layer
- layer-id :: L4
- implementation :: src/main/slot/layout.ts
- contains :: [[view]]

# View [[view]]

> 内容视图。最底层的内容单元，每个实例是独立的 WebContentsView。

- substance :: krig-layer
- type :: layer
- layer-id :: L5
- defines :: [[note-view]]
- defines :: [[ebook-view]]
- defines :: [[web-view]]
- defines :: [[thought-view]]
- defines :: [[graph-view]]

---

# ViewType [[view-type]]

> L5 View 的类型标识：'note' | 'ebook' | 'web' | 'thought' | 'graph'。

- substance :: krig-concept
- type :: concept
- defines :: [[note-view]]
- defines :: [[ebook-view]]
- defines :: [[web-view]]
- defines :: [[thought-view]]
- defines :: [[graph-view]]

# NoteView [[note-view]]

> ProseMirror 富文本笔记编辑器。

- substance :: krig-view
- type :: view
- view-type :: note
- entry :: src/plugins/note/components/NoteView.tsx
- max-per-workspace :: 2
- routes-to :: [[thought-view]]
- routes-to :: [[ebook-view]]
- routes-to :: [[web-view]]

# EBookView [[ebook-view]]

> 电子书阅读器（PDF / EPUB / DjVu / CBZ）。

- substance :: krig-view
- type :: view
- view-type :: ebook
- entry :: src/plugins/ebook/
- max-per-workspace :: 2
- routes-to :: [[note-view]]
- routes-to :: [[thought-view]]

# WebView [[web-view]]

> Web 浏览器。加载任意 URL，包括 ChatGPT / Claude / Gemini 等 AI 服务。

- substance :: krig-view
- type :: view
- view-type :: web
- entry :: src/plugins/web/components/
- max-per-workspace :: 2
- routes-to :: [[note-view]]

# ThoughtView [[thought-view]]

> 思考 / 批注面板。Thought 关联到 NoteView block 或 EBookView 高亮。

- substance :: krig-view
- type :: view
- view-type :: thought
- entry :: src/plugins/thought/
- max-per-workspace :: 1
- routes-to :: [[note-view]]
- routes-to :: [[ebook-view]]

# GraphView [[graph-view]]

> 知识图谱可视化。基于 Three.js + 自建 SVG 几何渲染管线。

- substance :: krig-view
- type :: view
- view-type :: graph
- entry :: src/plugins/graph/
- max-per-workspace :: 1

---

# LayoutMode [[layout-mode]]

> Slot 的划分方式。命名规则：{leftView}+{rightView} 或 {view}-only。

- substance :: krig-concept
- type :: concept

# NavMode [[nav-mode]]

> NavSidebar 的工作模式：'note' | 'ebook' | 'web' | 'ai' | 'graph'。

- substance :: krig-concept
- type :: concept

# IPC [[ipc]]

> View 间通信总线。所有跨 View 通信都经过 main 进程路由。

- substance :: krig-concept
- type :: concept
- naming-convention :: note: / ebook: / web: / thought: / graph:
- defined-at :: src/shared/types.ts

---

# Shell 组件族 [[shell-component-cluster]] {kind: surface}

> Shell 内部的 4 个组件集合（演示 Surface boundary 语法）。

- substance :: krig-grouping
- boundary :: [[workspace-bar]]
- boundary :: [[nav-sidebar]]
- boundary :: [[workspace-area]]
- boundary :: [[overlays]]

# View 类型族 [[view-cluster]] {kind: surface}

> 5 种 View 类型的集合。

- substance :: krig-grouping
- boundary :: [[note-view]]
- boundary :: [[ebook-view]]
- boundary :: [[web-view]]
- boundary :: [[thought-view]]
- boundary :: [[graph-view]]

# 6 层模型 [[six-layer-cluster]] {kind: surface}

> L0-L5 应用层级集合。

- substance :: krig-grouping
- boundary :: [[application]]
- boundary :: [[window]]
- boundary :: [[shell]]
- boundary :: [[workspace]]
- boundary :: [[slot]]
- boundary :: [[view]]
