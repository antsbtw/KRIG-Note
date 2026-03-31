# View — 定义

> **前置**：本文档是 `视图层级定义.md` 中 L3 View 的独立展开。
> View 是最底层的内容单元，由插件实现，框架定义接口契约。

---

## 一、是什么

View 是 Workspace 内的**内容视图**。用户看到的所有内容（笔记、PDF、网页、图谱）都通过 View 呈现。

- 每个 View 由插件实现，框架只定义接口
- View 放在 Slot 中渲染，Slot 决定位置和大小，View 决定内容
- View 之间默认孤立，有联系的 View 通过协同协议通信

---

## 二、View 结构

所有 View 的内部结构统一，由框架约束：

```
┌─ View ─────────────────┐
│ [Toolbar]              │  ← 固定在顶部，View 内部渲染
│ ────────────────────── │
│                        │
│      Content           │  ← 占据剩余空间，View 的主体
│      (+ Overlays)      │  ← 浮窗由 View 自管理
│                        │
└────────────────────────┘
```

| 组成 | 职责 | 管理者 |
|------|------|--------|
| **Toolbar** | 当前 View 的操作入口（导航、格式化、功能按钮等） | View 自己 |
| **Content** | 内容渲染区（编辑器、PDF 页面、网页、图谱画布） | View 自己 |
| **Overlays** | 浮窗（SlashMenu、右键菜单、FloatingToolbar 等） | View 自己 |

**框架只保证这个布局结构**。Toolbar 里有什么按钮、Content 里渲染什么、Overlays 有哪些——全部由 View 插件自己决定。

---

## 三、View 的身份：Type + Variant

### 3.1 ViewType

```typescript
type ViewType = 'note' | 'pdf' | 'web' | 'graph';
```

ViewType 是 View 的基础类型分类，每种 ViewType 对应一种独立的 View 实现。

### 3.2 Variant

Variant 是同一 ViewType 下的行为变体。框架不限制 variant 的取值，由插件自行定义。

| ViewType | variant | 说明 |
|----------|---------|------|
| `note` | — | 标准笔记编辑 |
| `note` | `thought` | 批注模式（锚点绑定、精简 Toolbar、只读锚点文本） |
| `web` | — | 标准网页浏览 |
| `web` | `ai` | AI 对话模式（固定 AI 服务 URL、SSE 捕获） |

### 3.3 Variant 的行为差异

Variant 改变的是 View 的**属性和行为**，不改变 View 的结构（仍然是 Toolbar + Content + Overlays）。

**NoteView vs NoteView:thought**

| 维度 | NoteView | NoteView:thought |
|------|----------|-----------------|
| Content | 完整文档编辑 | Thought 列表（每条 Thought 是一个迷你编辑器） |
| Toolbar | 完整编辑 Toolbar | 精简 Toolbar（筛选、排序） |
| 数据来源 | 独立文档（NoteFile） | 附着在主文档锚点上的 Thought 数据 |
| 可独立存在 | 是 | 通常与 NoteView/PDFView 配对使用 |

**WebView vs WebView:ai**

| 维度 | WebView | WebView:ai |
|------|---------|------------|
| 默认 URL | 无（用户导航） | AI 服务 URL（ChatGPT/Claude/Gemini） |
| 导航 | 自由导航 | 限定在 AI 服务域内 |
| 增强层 | 无 | SSE 捕获 + 响应解析 |
| 可独立存在 | 是 | 是 |

---

## 四、View 接口

框架定义所有 View 必须实现的接口契约：

```typescript
interface ViewInterface {
  // ── 身份 ──
  readonly type: ViewType;
  readonly variant?: string;

  // ── 生命周期 ──
  create(config: ViewConfig): void;       // 懒创建：初始化 View 实例
  show(bounds: Bounds): void;              // 显示：设置位置和大小
  hide(): void;                            // 隐藏：保留内部状态
  destroy(): Promise<void>;                // 销毁：保存数据 + 释放资源

  // ── 状态 ──
  getState(): PersistedViewState;          // 序列化当前状态（持久化用）
  restoreState(state: PersistedViewState): void;  // 从持久化恢复

  // ── 焦点 ──
  focus(): void;                           // 获取焦点
  blur(): void;                            // 失去焦点
}

interface ViewConfig {
  type: ViewType;
  variant?: string;
  instanceId: ViewInstanceId;
  // 各 View 类型的初始化参数（由 View 自行定义）
  data?: Record<string, unknown>;
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
```

### 4.1 接口说明

| 方法 | 调用者 | 时机 |
|------|--------|------|
| `create` | Workspace | 用户首次触发需要该 View 的操作 |
| `show` | Workspace | View 需要显示时（切换 WorkMode、切换 Workspace、打开 Right Slot） |
| `hide` | Workspace | View 需要隐藏时（切换 WorkMode、关闭 Right Slot、切换 Workspace） |
| `destroy` | Workspace | Workspace 关闭时 |
| `getState` | Workspace | 持久化时（布局变更、应用退出、定时自动保存） |
| `restoreState` | Workspace | 应用启动恢复时 |
| `focus` | Workspace | 切换 Workspace 后，焦点移到主 View |
| `blur` | Workspace | 焦点转移到其他 View |

### 4.2 框架不关心的事

| 事项 | 说明 |
|------|------|
| View 内部如何渲染 | 框架只调 show(bounds)，View 自己决定用什么技术渲染 |
| Toolbar 有什么按钮 | View 自己定义 |
| Overlays 有哪些 | View 自己管理 |
| 内部状态结构 | 框架只通过 getState/restoreState 做序列化，不理解内部数据 |

---

## 五、View 注册

View 类型通过注册机制声明，框架不硬编码任何 ViewType。

```typescript
interface ViewTypeRegistration {
  type: ViewType;                          // 基础类型
  variants?: string[];                     // 支持的 variant 列表
  factory: (config: ViewConfig) => ViewInterface;  // 创建 View 实例的工厂函数
}
```

当前注册的 View 类型：

| type | variants | 插件 |
|------|----------|------|
| `note` | `['thought']` | Note 插件 |
| `pdf` | — | PDF 插件 |
| `web` | `['ai']` | Web 插件 |
| `graph` | — | Graph 插件 |

> 新增 ViewType 或 variant = 插件注册一个新的 `ViewTypeRegistration`，框架不改。

---

## 六、View 生命周期

```
                    ┌──────────┐
                    │  未创建   │ ← Workspace 刚建立，View 实例池为空
                    └────┬─────┘
                         │ 用户首次触发
                         ▼
                    ┌──────────┐
              ┌────→│  已创建   │←───┐
              │     │  (隐藏)   │    │
              │     └────┬─────┘    │
              │          │ show()   │ hide()
              │          ▼          │
              │     ┌──────────┐   │
              │     │  显示中   │───┘
              │     │  (活跃)   │
              │     └────┬─────┘
              │          │
              └──────────┘
                         │ Workspace 关闭
                         ▼
                    ┌──────────┐
                    │  已销毁   │
                    └──────────┘
```

### 6.1 状态转换规则

| 转换 | 触发 | View 行为 |
|------|------|----------|
| 未创建 → 已创建 | `create()` | 初始化内部结构，不渲染 |
| 已创建 → 显示中 | `show(bounds)` | 渲染到指定位置和大小 |
| 显示中 → 已创建 | `hide()` | 隐藏，保留所有内部状态 |
| 已创建/显示中 → 已销毁 | `destroy()` | 保存数据，释放资源 |

### 6.2 生命周期不变量

1. **懒创建**：View 在首次需要时才 create()，不提前创建
2. **状态保留**：hide() 不丢失任何内部状态，show() 后与 hide() 前一致
3. **保存先于销毁**：destroy() 必须等待数据保存完成后才释放资源
4. **生命周期绑定 Workspace**：View 随 Workspace 懒创建，随 Workspace 关闭销毁

---

## 七、View 持久化

View 的持久化由 View 自己负责。框架只在需要时调用 getState() / restoreState()。

```typescript
interface PersistedViewState {
  instanceId: ViewInstanceId;
  type: ViewType;
  variant?: string;
  data: Record<string, unknown>;  // View 自行定义的持久化数据
}
```

各 View 类型的持久化数据示例：

| ViewType | 持久化字段 | 说明 |
|----------|-----------|------|
| `note` | documentId, scrollPosition | 恢复到同一文档的同一位置 |
| `note:thought` | sourceDocumentId, filter | 恢复到同一文档的 Thought 列表 |
| `pdf` | filePath, pageNumber, zoom | 恢复到同一 PDF 的同一页 |
| `web` | url | 恢复到同一网页 |
| `web:ai` | serviceUrl | 恢复到同一 AI 服务 |
| `graph` | viewportCenter, zoom | 恢复图谱视口 |

---

## 八、View 之间的关系

### 8.1 默认孤立

任意两个 View 放入 Left + Right Slot，默认**无协同**，各自独立工作。这是 View 的常态。

### 8.2 协同协议

特定 View 组合可以通过**协同协议**建立联系。协同协议定义了两个 View 之间的通信行为。

协同协议不是 View 的属性，而是**两个 View 之间的关系**，由组合查表决定。

```
任意两个 View 放入 Left + Right Slot
  → 查协同协议表
    → 匹配到协议 → 启用对应行为
    → 未匹配 → 无协同（默认）
```

**详细定义**：`ui-framework/view-protocol.md`

### 8.3 通信路由

所有 View 间通信（无论是否有协同协议）都经过 main 进程路由。View 之间不直接通信。

---

## 九、约束（不变量）

1. **结构统一**：所有 View 的内部结构为 Toolbar + Content + Overlays，框架不允许其他布局
2. **Toolbar 属于 View**：框架不管理 Toolbar 的内容和行为。Toolbar 是 View 的内部组件
3. **Overlay 属于 View**：View 自管理浮窗，不依赖全局 Overlay 层
4. **View 不知道 Slot**：View 通过 show(bounds) 接收位置和大小，不知道自己在 Left 还是 Right Slot
5. **View 不知道对面**：View 不知道另一个 Slot 放了什么 View。协同行为由框架的协同协议层注入，View 只收发消息
6. **注册制**：框架不硬编码任何 ViewType 或 variant。所有 View 类型通过注册接口声明
7. **默认孤立**：任意 View 组合默认无协同。只有协同协议表中明确匹配的组合才启用协同行为
8. **通信经过路由**：所有跨 View 通信经过 main 进程路由，View 之间不直接通信
