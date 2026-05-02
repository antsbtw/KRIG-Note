# KRIG-Note L5 业务视图层（EBook 电子书）架构评估与改造建议

> **核心原则重申**：
> 1. **下层不能干预上层的业务**：EBook 插件只需安心渲染 PDF/EPUB 和管理书签，无权决定窗口布局和它与谁并排显示。

---

## 一、 现状评估

**主要涉及区域**：`src/plugins/ebook/`

### 1. 优秀设计：格式兼容与状态隔离
EBook 插件很好地封装了对 PDF、EPUB 等多种格式的解析和渲染，其内部的阅读进度（Progress）和书签（Bookmark）管理相对独立，没有污染到框架核心层。

### 2. 违规行为：硬编码清屏指令
**代码证据**：
`src/plugins/ebook/navside/useEBookOperations.ts` 中存在 `void navSideAPI.closeRightSlot();` 调用。

**评估结论**：**越权干预**。和 NotePlugin 一样，EBook 插件在执行“打开书籍”这种本分操作时，夹带了“强制关闭右分屏”的私货。如果用户当时正在右屏做笔记，点击换一本书就会导致笔记窗口莫名其妙被关掉。这就是下层越权带来的 UX 灾难和逻辑冲突。

---

## 二、 改造建议（Refactoring Guide）

### 1. 剥离排版干预
**修改点**：立刻从 `useEBookOperations.ts` 中删除 `closeRightSlot()`。
**新契约**：EBook 视图不应该去假设当前的布局环境。它只负责在被分配到的空间里（无论是全屏、左半屏还是右半屏）尽职尽责地渲染图书。它需要通过 IPC 通知 main 进程：“我的活跃书籍变了”（`EBOOK_SET_ACTIVE_BOOK`），至于右侧要不要关闭，由 Workspace 根据当前的布局策略（Layout Mode）自行决定。

**总结**：EBook 插件相对克制，只要剔除掉那几行强行越权的 API，就是一个高度内聚、符合原则的良好模块。
