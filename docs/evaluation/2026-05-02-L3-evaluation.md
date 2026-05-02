# KRIG-Note L3 层（Workspace 工作空间）架构评估与改造建议 (2026-05-02)

> **核心原则重申**：
> 1. **上层不插手下层的业务**：L3 作为一个抽象的工作环境容器，负责调配资源和隔离状态，绝不能硬编码任何与具体业务（如 Note、EBook）相关的字段。
> 2. **注册与自治**：工作模式（WorkMode）和视图类型的扩展应该是由插件向下“注册”，L3 只按图索骥。

---

## 一、 L3（Workspace 层）现状评估

**涉及文件**：`src/main/workspace/manager.ts`、`src/main/workmode/registry.ts`、`src/shared/types.ts`

L3 层作为 KRIG-Note 的“调度大脑”，在工作模式的抽象上做得很好，但在状态数据结构的定义上却严重违规。

### 1. 正向进展：WorkMode 的彻底注册制（符合“上层不插手下层”）
**代码证据**：`src/main/workmode/registry.ts`
```typescript
class WorkModeRegistry {
  private modes: Map<string, WorkModeRegistration> = new Map();
  // 框架不硬编码任何 WorkMode，全部由插件通过 register() 声明。
}
```
**评估结论**：**非常优秀**。L3 层在定义业务模式时，成功引入了注册制。无论是“纯笔记模式”、“阅读模式”还是未来的“图谱模式”，都不需要修改 L3 的代码。L3 变成了纯粹的策略执行者。

### 2. 致命违规：WorkspaceState 沦为“大杂烩”（违背“上层不插手下层”）
**代码证据**：`src/shared/types.ts` 第 21-39 行。
```typescript
export interface WorkspaceState {
  id: WorkspaceId;
  // ...通用的容器属性...
  slotBinding: { left: ViewInstanceId | null; right: ViewInstanceId | null; }; // 这是对的
  
  // 越权违规：L3 替 L5 保存了具体的业务状态
  activeNoteId: string | null;        // NoteView 的状态
  rightActiveNoteId: string | null;   
  expandedFolders: string[];          
  activeBookId: string | null;        // EBookView 的状态
  ebookExpandedFolders: string[];     
  activeGraphId: string | null;       // GraphView 的状态
}
```
**评估结论**：**极差（必须重构）**。`WorkspaceState` 是 L3 的核心数据结构，它本该是纯净的容器。但现在它被塞满了特定业务模块（Note、EBook、Graph）的私有状态。
这导致了一个荒谬的现象：如果团队明天开发了一个全新的 `VideoPlugin`（视频视图），我们竟然必须去修改 L3 的底层数据结构，加上一个 `activeVideoId: string` 才能持久化它的状态。这完全破坏了插件体系的“开闭原则”（Open-Closed Principle）。

### 3. IPC 通信：存在过多跨层定制指令
**代码证据**：`IPC` 常量表中，除了 `WORKSPACE_CREATE`、`WORKSPACE_SWITCH` 等合理的 L3 指令外，充斥着 `SET_ACTIVE_NOTE`、`EBOOK_SET_ACTIVE_BOOK` 等专门为了同步上述错误状态而发明的 IPC 通道。
**评估结论**：这是数据结构设计错误导致的连锁反应。为了维护那些不该由 L3 维护的业务状态，L3 被迫增加了一堆专用通信渠道。

---

## 二、 改造建议与实施路径（Refactoring Guide）

为了让 L3 回归“纯粹容器”的本质，必须对 `WorkspaceState` 进行“清创手术”。

### 改造目标 1：将业务状态下放给插件自治
**要求**：L3 只能保存泛型的插件状态，绝对不出现 `note`、`ebook` 等字眼。
1. **修改点**：在 `WorkspaceState` 中，删除所有 `activeNoteId`、`activeBookId`、`expandedFolders` 等强业务字段。
2. **新契约**：将这些字段替换为一个通用的键值对字典：
   ```typescript
   export interface WorkspaceState {
     // ...
     // 业务模块的私有状态持久化存储区（L3 不解析，只负责存取）
     pluginStates: Record<string, PersistedViewState>; 
   }
   ```
   当 `NoteView` 需要保存 `activeNoteId` 时，它自己将数据打包成 JSON，通过统一的 `workspace:save-plugin-state` IPC 接口告知 L3。L3 只是原封不动地把这段 JSON 存进 `pluginStates['note']` 里。

### 改造目标 2：统一视图同步接口
**要求**：消灭 `SET_ACTIVE_NOTE` 等专用 IPC 通道。
1. **修改点**：废除散落在各处的业务态同步接口。
2. **新契约**：所有视图在发生状态变化时（例如笔记切换、书本翻页），通过统一的 `PersistedViewState` 接口向上传递。Workspace 在恢复时，也只是把 `pluginStates['note']` 再扔回给 `NotePlugin`，让插件自己去解析并恢复之前的视图现场。

---

**总结**：L3 层的“调度与隔离”逻辑写得不错（得益于 `manager.ts` 的干净），但它在“持久化状态”时当了“好人”，替插件干了它们自己该干的脏活。把这些私有状态清理出去，用一个泛型的 `pluginStates` 字典代替，L3 就完美了。
