# KRIG-Note L5 业务视图层（Web 浏览器与 AI）架构评估与改造建议

> **核心原则重申**：
> 1. **下层不能干预上层的业务**：Web 和 AI 组件只能提供网页渲染和特定的内容提取能力，它绝对不应该拥有“随心所欲撕开任何面板”的权力。

---

## 一、 现状评估

**主要涉及区域**：`src/plugins/web/`

### 1. 优秀设计：统一渲染内核
系统正确地将网页浏览和多种 AI 服务（ChatGPT, Claude 等）收敛到了相同的 WebView 引擎下，通过外挂 `browser-capability` 提取数据，这在 L5 层的逻辑重用上做得非常好。

### 2. 灾难级违规：疯狂滥用特权 API 开副屏
**代码证据**：
1. `src/plugins/web/navside/useWebOperations.ts` 中调用了 `navSideAPI.closeRightSlot()`。
2. `src/plugins/web/main/ipc-handlers.ts` 是最严重的灾区，内部充斥着大量对 `ctx.openCompanion(...)` 的直接调用：
   - 唤起 AI 时：`ctx.openCompanion('ai-web')`
   - 提取数据时：`ctx.openCompanion('extraction')`
   - 甚至是 Demo 代码中：`ctx.openCompanion('demo-a')`

**评估结论**：**极度越权**。Web 插件可以说是利用了 L0 暴露出来的漏洞最严重的模块。它不仅管自己的渲染，还充当了半个窗口管理器（Window Manager）。当一个具体的插件直接指定要打开“extraction”或“ai-web”时，不仅严重违背了单向依赖，还造成了强耦合（Web 插件强制知道了 Extraction 和 Demo 组件的存在）。

---

## 二、 改造建议（Refactoring Guide）

### 1. 剥离所有的 `openCompanion` 调用
**要求**：Web 插件必须立刻上交调度权。
**修改点**：
- 在 `useWebOperations.ts` 中删除 `closeRightSlot`。
- 在 `ipc-handlers.ts` 中，拦截到诸如 `AI_ASK_VISIBLE` 等指令时，**绝对不能**直接调用 `ctx.openCompanion`。
- 应当抛出事件（例如 `IPC.WORKSPACE_INTENT_DISPATCH`, `{ action: 'show-ai-assistant' }`），由主框架统一捕获并分配 Slot 容器给对应的 ViewType。

**总结**：Web 插件是目前干涉布局逻辑最严重的模块，必须下猛药彻底斩断其对布局框架的调用，逼迫其退回真正的视图层。
