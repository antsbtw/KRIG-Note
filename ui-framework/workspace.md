# L2 — Workspace 定义

> **前置**：本文档是 `视图层级定义.md` 中 L2 Workspace 的独立展开。
> 静态结构（View 实例池图示）见视图层级定义，此处不重复。
> 本文档聚焦：状态模型、切换机制、持久化策略。

---

## 一、Workspace 是什么

Workspace 是用户**独立的工作环境**。

- 它不是 UI 组件，而是逻辑实体
- 它拥有自己的状态、自己的 View 实例池、自己的导航历史
- 切换 Workspace = 切换整个工作上下文

类比：浏览器的"窗口"。每个窗口有自己的 Tab 栈和历史记录，互不干扰。

---

## 二、状态模型

一个 Workspace 在任意时刻的完整状态：

```typescript
interface WorkspaceState {
  // ── 身份 ──
  id: string;                    // 唯一标识
  label: string;                 // WorkspaceBar 上显示的名称

  // ── 工作模式 ──
  workModeId: string;            // 当前活跃的 WorkMode（注册制 id）

  // ── 布局 ──
  navSideVisible: boolean;       // NavSide 是否展开
  dividerRatio: number;          // 左右 Slot 的分割比例（0.0–1.0）

  // ── View 实例池 ──
  views: Map<ViewInstanceId, ViewState>;  // 已创建的 View 实例

  // ── Slot 绑定 ──
  slotBinding: {
    left: ViewInstanceId | null;   // Left Slot 当前显示的 View
    right: ViewInstanceId | null;  // Right Slot 当前显示的 View
  };
}
```

### 2.1 ViewState

每个 View 实例自身维护的状态（Workspace 只持有引用，不侵入 View 内部）：

```typescript
interface ViewState {
  instanceId: ViewInstanceId;    // 实例 ID（如 'note-A1'）
  type: ViewType;                // 类型（'note' | 'pdf' | 'web' | 'graph'）
  variant?: string;              // 变体（'thought' | 'ai' | undefined）
  created: boolean;              // 是否已创建（懒创建标记）

  // View 内部状态由 View 自己管理，Workspace 不感知细节。
  // 例如 NoteView 的 documentId、scrollPosition、selection
  //      PDFView 的 filePath、pageNumber、zoom
  //      WebView 的 url、navigationHistory
}
```

### 2.2 状态分层原则

| 层级 | 谁管理 | 示例 |
|------|--------|------|
| **Workspace 级** | Workspace 自己 | workModeId, dividerRatio, slotBinding |
| **View 级** | 各 View 自己 | documentId, scrollPos, url, zoom |

Workspace 知道"哪个 View 在哪个 Slot"，但不知道"那个 View 里面正在看什么"。

---

## 三、生命周期

```
创建 ─→ 活跃 ←─→ 后台 ─→ 关闭
```

### 3.1 各阶段定义

| 阶段 | 条件 | View 状态 | 资源 |
|------|------|-----------|------|
| **创建** | 用户点击 [+] 或快捷键 | 空的 View 实例池 | 最小化 |
| **活跃** | 当前选中的 Workspace | 活跃 View 可见并接收输入 | 完整 |
| **后台** | 非当前选中 | 所有 View 隐藏，状态保留 | 保留（不释放） |
| **关闭** | 用户点击 [×] 或快捷键 | 全部 View 销毁 | 释放 |

### 3.2 创建

```
用户触发创建
  → 生成 WorkspaceState（默认 workModeId, 空 View 池）
  → 切换到新 Workspace（见 §四 切换机制）
```

**默认状态**：

| 字段 | 默认值 | 说明 |
|------|--------|------|
| workModeId | `'note'` | 新 Workspace 默认进入笔记模式 |
| navSideVisible | `true` | — |
| dividerRatio | `0.5` | 仅在双 Slot 布局时生效 |
| views | 空 Map | View 懒创建 |
| slotBinding.left | `null` | WorkMode 切换时懒创建 Left Slot View |
| slotBinding.right | `null` | 用户操作触发时才打开 Right Slot |

### 3.3 关闭

```
用户触发关闭
  → 所有 View 保存数据（异步，等待完成）
  → 所有 View 销毁（释放 WebContentsView / DOM）
  → 从 WorkspaceBar 移除
  → 切换到相邻 Workspace
  → 如果是最后一个 Workspace：创建新的默认 Workspace
```

**关闭保护**：如果有 View 正在保存或有未保存更改，弹出确认。

---

## 四、切换机制

切换 Workspace 是最核心的操作。涉及：旧 Workspace 的 View 隐藏 + 新 Workspace 的 View 显示 + NavSide 内容切换。

### 4.1 切换流程

```
用户点击 WorkspaceLabel 或快捷键
  │
  ├── 1. 标记旧 Workspace 为「后台」
  │     └── 隐藏旧 Workspace 所有活跃 View（不销毁）
  │
  ├── 2. 标记新 Workspace 为「活跃」
  │     └── 显示新 Workspace 的 slotBinding 对应的 View
  │         ├── View 已创建 → show + 设置位置大小
  │         └── View 未创建 → 懒创建 → show
  │
  ├── 3. NavSide 内容切换
  │     └── 根据新 Workspace 的 workModeId 切换 ModeBar + ActionBar + ContentList
  │
  └── 4. 焦点转移
        └── 焦点移到新 Workspace 的主 View（Left Slot）
```

### 4.2 切换不变量

1. **零状态丢失**：后台 Workspace 的所有 View 状态完整保留，切回时与离开时一致
2. **零重载**：切换只改变可见性，不重新加载 View 内容
3. **NavSide 同步**：NavSide 的 ModeBar 选中状态和 Content List 必须立即反映新 Workspace 的 workModeId
4. **焦点唯一**：同一时刻只有一个 Workspace 的一个 View 持有焦点

---

## 五、持久化策略

### 5.1 什么需要持久化

关闭应用再打开，用户应看到与离开时一样的工作环境。

| 数据 | 是否持久化 | 说明 |
|------|-----------|------|
| Workspace 列表 + 顺序 | **是** | 恢复 WorkspaceBar |
| 每个 Workspace 的 workModeId, dividerRatio | **是** | 恢复工作模式和布局 |
| 每个 Workspace 的 slotBinding | **是** | 恢复哪个 View 在哪个 Slot |
| 每个 View 的内部状态 | **是**（由 View 自己负责） | 恢复打开的文档/页面/滚动位置 |
| 哪个 Workspace 是活跃的 | **是** | 恢复用户离开时的焦点 |

### 5.2 持久化结构

```typescript
interface PersistedSession {
  activeWorkspaceId: string;
  workspaces: PersistedWorkspace[];
}

interface PersistedWorkspace {
  id: string;
  label: string;
  workModeId: string;
  navSideVisible: boolean;
  dividerRatio: number;
  slotBinding: {
    left: ViewInstanceId | null;
    right: ViewInstanceId | null;
  };
  views: PersistedViewState[];  // 每个 View 自行序列化的状态
}

interface PersistedViewState {
  instanceId: ViewInstanceId;
  type: ViewType;
  variant?: string;
  // View 特有的持久化数据（由各 View 类型定义）
  data: Record<string, unknown>;
}
```

### 5.3 存储时机

| 事件 | 持久化内容 |
|------|-----------|
| **WorkMode 切换** | workModeId, slotBinding |
| **Slot 变更** | slotBinding, dividerRatio |
| **Workspace 创建/关闭/排序** | Workspace 列表 |
| **应用退出** | 完整 Session |
| **定时自动保存** | 完整 Session（防崩溃丢失） |

### 5.4 恢复流程

```
应用启动
  → 读取 PersistedSession
  → 按顺序创建 Workspace（仅创建状态，不创建 View）
  → 切换到 activeWorkspaceId
  → 该 Workspace 的活跃 View 懒创建 + 恢复内部状态
  → 其他 Workspace 保持「后台」，其 View 在用户切换时才懒创建
```

---

## 六、Workspace 操作汇总

| 操作 | 入口 | 前置条件 | 效果 |
|------|------|---------|------|
| **创建** | WorkspaceBar [+] / 快捷键 | — | 新建默认 Workspace 并切换 |
| **切换** | 点击 WorkspaceLabel / 快捷键 | 目标 ≠ 当前 | 见 §四 |
| **关闭** | 点击 [×] / 快捷键 | — | 保存 → 销毁 → 切到相邻 |
| **重命名** | 双击 WorkspaceLabel | — | 修改 label |
| **排序** | 拖拽 WorkspaceLabel | — | 改变 WorkspaceBar 顺序 |
| **切换 WorkMode** | NavSide ModeBar / 快捷键 | — | 更新 workModeId + slotBinding.left |
| **调整分割** | 拖拽 Divider | 双 Slot 布局 | 更新 dividerRatio |

---

## 七、约束（不变量）

1. **至少一个 Workspace**：不允许关闭到零个。关闭最后一个时自动创建新的。
2. **恰好一个活跃**：任意时刻有且仅有一个 Workspace 处于活跃状态。
3. **Workspace 隔离**：不同 Workspace 的 View 实例没有任何直接关联。
4. **View 生命周期绑定 Workspace**：View 随 Workspace 懒创建，随 Workspace 关闭销毁。
5. **持久化完整性**：应用重启后 Workspace 布局和 View 状态可完整恢复。
6. **切换零重载**：切换 Workspace 不重新加载任何 View 的内容。
7. **WorkMode 注册制**：Workspace 不硬编码可用的 WorkMode 列表，从注册表获取。
