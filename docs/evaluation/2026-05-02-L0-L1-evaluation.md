# KRIG-Note L0/L1 层架构评估与改造建议 (2026-05-02)

> **核心原则重申**：
> 1. **上层不插手下层的业务**：L0/L1 作为全局底座，只能制定“如何加载插件”的规则，不能写死要加载“哪些具体插件”。
> 2. **下层不能干预上层的业务**：L0/L1 作为统筹者，可以决定布局，但绝不能把“控制布局的特权 API”下发给插件（L5）。

---

## 一、 L1 / L0（主进程与应用基础）层现状评估

### 1. 越权暴露编排 API（违背“下层不能干预上层”）
**证据位置**：`src/main/app.ts` 第 39-45 行。
```typescript
function registerPlugins(): void {
  const ctx = {
    getMainWindow,
    openCompanion: openRightSlot, // 致命漏洞：把控制 L4 Slot 的能力给了 L5 View
    ensureCompanion: openRightSlot, 
    // ...
  };
  registerNotePlugin(ctx);
  // ...
}
```
**评估结论**：这是典型的“防线失守”。`app.ts` 作为最高层，主动把 `openRightSlot` 这种直接控制 L4 布局的核心 API 打包进了 `ctx` 传给了 L5 的插件。这直接导致了下游插件可以为所欲为地干预全局布局，破坏了单向数据流。

### 2. 违反“开闭原则”与硬编码耦合（违背“上层不插手下层”）
**证据位置**：`src/main/app.ts` 第 18-22 行 及 第 48-53 行。
```typescript
import { register as registerNotePlugin } from '../plugins/note/main/register';
import { register as registerWebPlugin } from '../plugins/web/main/register';
// ...
```
**评估结论**：`app.ts` 是一切的起点（L0），但它却精准地写死了所有业务插件（L5）的名字和路径。这就意味着，每次团队想要新增、删除或重命名一个业务模块，都必须修改主程序入口文件。这完全违背了“注册制”的初衷，L0 越权充当了 L5 的大管家。

### 3. 底层类型污染高层契约
**证据位置**：`src/shared/types.ts`（参考 4 月 21 日评估报告）。
**评估结论**：`shared` 应该是最纯净的契约层，但内部却引入了 Electron 原生的 `WebContentsView` 等类型。这相当于 L0 的实现细节（Electron）反向污染了共享协议，如果未来我们想引入纯净的单元测试，这块代码会直接报错。

---

## 二、 改造建议与实施路径（Refactoring Guide）

为了彻底纠正 L0/L1 的倒置问题，建议采取以下改造措施：

### 改造目标 1：收缴插件的“布局特权”
**要求**：彻底切断 L5 干预 L4/L3 的通道。
1. **修改点**：在 `src/main/app.ts` 中，从传给插件的 `ctx` 对象里**删除** `openCompanion`、`ensureCompanion` 等直接操作 Slot 的 API。
2. **新契约**：插件需要改变布局时，只能通过发送标准的**意图事件**（Intent Event），例如触发一个 `IPC.WORKSPACE_INTENT_DISPATCH`。由 L3 Workspace 捕获意图后，自己决定要不要开 RightSlot，以及开多大。

### 改造目标 2：实现真正的“插件发现与注册”机制
**要求**：让 `app.ts` 对具体插件的存在“一无所知”，实现解耦。
1. **修改点**：删除 `app.ts` 中针对 `registerNotePlugin` 等具体插件的硬编码 import。
2. **新契约**：在 `src/plugins/` 目录下建立一个统一的 `manifest.ts` 或入口文件扫描机制（Plugin Loader）。`app.ts` 只负责执行类似 `pluginLoader.loadAll(ctx)` 的统一方法。新增插件只需在 `plugins` 目录下按规范添加文件，L0 代码实现“零修改”。

### 改造目标 3：净化 `shared` 契约层
**要求**：`shared` 文件夹内不允许出现任何对 `electron` 库的 import。
1. **修改点**：排查 `src/shared/types.ts`。如果存在类似 `viewCreated(view: WebContentsView)` 的定义，将其改为与平台无关的抽象类型（如暴露一个纯字符串 ID 或包装接口）。
2. **新契约**：底层的具体实例对象（如 Electron WebContents）只能在 `main/` 目录下流转，不能穿越到公共契约层。

---

**总结**：在 L0/L1 层的改造中，我们要做的事情其实是做减法。把本不属于 L0 的具体业务名单（import）剔除出去，把本不该给 L5 的布局特权（openRightSlot）收缴回来。只有基座稳定了，上面的 L2~L5 才有可能被正确地梳理。
