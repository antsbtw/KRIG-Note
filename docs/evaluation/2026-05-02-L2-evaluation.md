# KRIG-Note L2 层（Shell 全局框架）架构评估与改造建议 (2026-05-02)

> **核心原则重申**：
> 1. **上层不插手下层的业务**：L2 作为外壳，只提供占位符和公共控件，绝不能硬编码任何 L5 的具体业务逻辑。
> 2. **下层不能干预上层的业务**：L2 只是发号施令的 UI 外壳，不应该亲自去干预 L4 (Slot) 和 L3 (Workspace) 的具体排版调度逻辑。

---

## 一、 L2（Shell 层）现状评估

**涉及文件**：`src/renderer/navside/NavSide.tsx`、`src/renderer/shell/WorkspaceBar.tsx`

值得庆幸的是，经过 v1.4 版本的重构，L2 层的很多历史包袱已经被清理，但依然存在一些明显的违背原则的问题。

### 1. 正向进展：框架与插件已解耦（符合“上层不插手下层”）
**代码证据**：
- `NavSide.tsx` 中已经去掉了过去直接 `import { WebPanel }` 的灾难性代码，转而使用了 `panel-registry.ts` 中的 `getNavPanel(contentType)` 动态获取组件。
- 业务行为通过抛出自定义事件 `window.dispatchEvent(new CustomEvent('navside:action', ...))` 转交给了底层插件处理。
**评估结论**：**非常优秀**。L2 成功卸下了“上帝类”的重担，从 500 多行的面条代码精简到了 150 行，回到了“容器”的本职工作。

### 2. 越权指挥编排逻辑（违背“下层不能干预上层”）
**证据位置**：`src/renderer/navside/NavSide.tsx` 第 29 行及 `panel-registry.ts` 注释。
```typescript
  const handleSwitchMode = (id: string) => {
    void navSideAPI.closeRightSlot(); // 越权：L2 Shell 强行介入 L4 Slot 调度
    void navSideAPI.switchWorkMode(id);
  };
```
**评估结论**：虽然 `NavSide` 不管业务了，但它仍然保留着指挥排版（Slot）的特权。按照原则，L2 触发“切换模式”这个意图后，应该由 L3 (Workspace) 决定是否需要关闭 RightSlot，而不是由 L2 显式地调用 API 来强制关闭。这种硬编码会导致未来想做“多屏对照”时，频繁遭遇被意外关闭的问题。

### 3. UI 表现层与组件死锁（违背配置化原则）
**证据位置**：`WorkspaceBar.tsx` 和 `NavSide.tsx` 的底部，存在大量硬编码的 Inline Styles。
```typescript
// WorkspaceBar.tsx
const styles: Record<string, React.CSSProperties> = {
  bar: { background: '#1e1e1e', borderBottom: '1px solid #333' },
  // ...
}
```
**评估结论**：L2 框架的视觉表现被写死在了 React 组件内部。这意味着框架层没有建立统一的 Design Token（设计令牌）或 Theme（主题）抽象层。如果后续需要增加白昼模式，所有的框架文件都需要被侵入式修改。

---

## 二、 改造建议与实施路径（Refactoring Guide）

针对 L2 层的残留问题，接下来的改造应聚焦于**“收敛控制权”**和**“剥离样式”**：

### 改造目标 1：将排版调度权上交给 Workspace
**要求**：L2 只发送意图，不微操 L4。
1. **修改点**：在 `NavSide.tsx` 中，删除 `handleSwitchMode` 里的 `navSideAPI.closeRightSlot()` 调用。
2. **新契约**：当 `switchWorkMode(id)` 事件被抛到 Main 进程的 `workspaceManager` 时，由 Workspace 根据目标 WorkMode 的定义，在状态机内部自己算出最新的 Layout Mode 并通知所有 View。L2 彻底从布局的脏活中解放出来。

### 改造目标 2：建立全局 Design Token，消灭硬编码样式
**要求**：框架不再决定自己长什么样，只决定自己用什么“语义变量”。
1. **修改点**：废弃 `WorkspaceBar` 和 `NavSide` 中的硬编码颜色值（如 `#1e1e1e`, `#4a9eff`）。
2. **新契约**：在全局引入一套 CSS Variables（如 `var(--krig-bg-panel)`, `var(--krig-border-subtle)`）。L2 框架的组件只引用这些语义变量。这不仅能缩小文件体积，还能让“主题切换”成为 L0 层的一个无感知开关。

---

**总结**：L2 的骨架已经非常清晰，目前的重构方向是“百尺竿头，更进一步”。让 L2 不仅在**业务依赖**上保持纯净（这点已经做到），还要在**行为编排**和**视觉定义**上做到完全脱钩。
