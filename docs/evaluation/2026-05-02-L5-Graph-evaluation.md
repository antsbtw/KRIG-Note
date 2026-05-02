# KRIG-Note L5 业务视图层（Graph 知识图谱）架构评估与改造建议

> **核心原则重申**：
> 1. **下层不能干预上层的业务**：无论图谱多么庞大复杂，它在系统的架构视角中，依然只是一个可随时销毁和重建的画布组件，必须服从全局排版。

---

## 一、 现状评估

**主要涉及区域**：`src/plugins/graph/`

### 1. 优秀设计：与全局协议看齐
从文件结构看，Graph 插件学习了 eBook 和 Note 的模式，建立了自己独立的命名空间和 Store（`GRAPH_LIST`, `GRAPH_LOAD` 等 IPC 定义清晰），这保证了该插件内部状态的高内聚。

### 2. 残留违规：复制粘贴带来的越权
**代码证据**：
`src/plugins/graph/navside/useGraphOperations.ts` 依然原封不动地保留了 `void navSideAPI.closeRightSlot();` 的调用。

**评估结论**：**常规越权**。可以看出这是从 Note 和 eBook 那边借鉴（Copy-Paste）过来的逻辑。为了在点击图谱列表时获得“全屏体验”，依然采用了粗暴的命令式调用来关闭副屏。

---

## 二、 改造建议（Refactoring Guide）

### 1. 删除布局微操
**修改点**：和 Note/eBook 一样，删除 `useGraphOperations.ts` 中的 `closeRightSlot()` 语句。
**新契约**：如果图谱设计上必须全屏展示才能保证交互体验，不应该由图谱自己去强行关掉别人的屏幕。而应该由 Graph 插件向 L3 声明：“我的 WorkMode 需要使用 `graph-only` 布局”。当 Workspace 切换到这个模式时，调度系统自然会收起 RightSlot，一切都是顺理成章、职责分明的。

**总结**：Graph 层本身还比较薄，趁早把这些违规的布局调用剔除，防止后续逻辑愈发膨胀导致积重难返。
