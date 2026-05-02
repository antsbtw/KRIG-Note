# KRIG-Note L4 层（Slot 槽位与布局）架构评估与改造建议 (2026-05-02)

> **核心原则重申**：
> 1. **上层不插手下层的业务**：L4 Slot 只是一个几何计算器和渲染容器，它只关心 `x, y, width, height`，绝不能关心里面装的是不是 `NoteView` 或 `WebView`。
> 2. **下层不能干预上层的业务**：具体的 View（L5）不能自己跑出来喊“我要变宽”或者“给我开个右边栏”，这叫下级指挥上级。

---

## 一、 L4（Slot 层）现状评估

**涉及文件**：`src/main/slot/layout.ts`、`src/main/window/shell.ts`（部分调度逻辑）

L4 层作为纯粹的布局容器，在代码的物理计算层面做得非常优雅，但在与上下游互动的“政治边界”上却成了最严重的灾区。

### 1. 优秀设计：纯净的几何算法（符合“上层不插手下层”）
**代码证据**：`src/main/slot/layout.ts`
```typescript
export function calculateLayout(
  windowWidth: number, windowHeight: number, navSideVisible: boolean,
  hasRightSlot: boolean, dividerRatio: number
): LayoutResult {
  // 只返回几何位置，完全没有出现任何特定 View 的 import 
  return { leftSlot, rightSlot, divider, navSide /* ... */ };
}
```
**评估结论**：**极佳**。这里的抽象堪称教科书级别。`calculateLayout` 完全不知道什么是笔记、什么是电子书。它是一个纯粹的“木匠”，上层 Workspace 给他参数，他就老老实实地打出尺寸刚好的木盒子（Bounds）。这完美契合了分层原则。

### 2. 灾难级违规：被下层 View 夺舍的控制权（严重违背“下层不能干预上层”）
**代码证据**：`src/main/window/shell.ts` 及各处 View 的调用
```typescript
// shell.ts 暴露出的 API
export function openRightSlot(viewType: ViewType, variant?: string) { ... }
```
**评估结论**：**极差（核心痛点）**。目前，最底层的 L5 视图（例如 `NoteView` 里的某个按钮，或者 `WebView` 的工具栏）竟然可以直接调用 `openRightSlot`。
这就像是一个租客（View）可以直接命令大楼的物业（Slot）：“给我砸掉右边那堵墙，再给我造个新房间。” 
这彻底架空了 L3（Workspace）。按照原则，只有 Workspace 有权根据当前的工作模式（Layout Mode）决定是否开启右边栏。

### 3. SlotBinding 的伪分配
虽然 `WorkspaceState` 里有 `slotBinding: { left, right }` 的设计，但在目前的实际运行中，往往是 View 强行占据 Slot，而不是 Workspace 把 View “塞进” Slot。这种主次颠倒导致了当 Workspace 切换时，经常出现焦点错乱或视图闪烁。

---

## 二、 改造建议与实施路径（Refactoring Guide）

L4 层的改造必须配合之前 L3 和 L0 层的重构，核心思路是**“剥夺下层的调度权，将 Slot 降级为只读容器”**。

### 改造目标 1：废除所有面向 L5 的直接操作 API
**要求**：L4 Slot 拒绝接受来自 L5 的任何排版指令。
1. **修改点**：彻底删除或隐藏 `shell.ts` 中的 `openRightSlot`、`ensureRightSlot`、`closeRightSlot` 等 API。切断通过 `app.ts` 或 `viewAPI` 传递给插件的通道。
2. **新契约**：如果一个 `WebView` 想触发分屏翻译，它只能向上传递一条意图（Intent）：`dispatch('intent:split-screen-requested')`。

### 改造目标 2：将 Slot 退化为“响应式计算节点”
**要求**：Slot 只对 Workspace 的 Layout Mode 变化做出响应。
1. **修改点**：重构 Slot 的触发机制。当 L3（Workspace）接收到意图，计算出新的 `Layout Mode = 'web+web'` 时，Workspace 向 L4 广播：`"我的模式变了"`。
2. **新契约**：L4 收到广播后，老老实实调用它那纯洁的 `calculateLayout` 算出新的长宽，然后依次调用底下 L5 View 的 `.setBounds()`。

---

**总结**：L4 层的悲哀在于它本身是个纯洁的容器（`layout.ts` 证明了这一点），但它却被人当成了传话筒和提线木偶。通过切断 L5 对它的直接指挥，把控制权上交回给 L3，L4 就能成为一个无状态、且永远正确的排版引擎。
