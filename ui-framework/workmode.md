# WorkMode — 定义

> **前置**：本文档是 `视图层级定义.md` 中 WorkMode 概念的独立展开。
> WorkMode 是 Workspace 的核心驱动状态，决定 NavSide 显示什么内容、Left Slot 默认打开什么 View。

---

## 一、是什么

WorkMode 是 Workspace 的**主工作模式**。

- 它不是硬编码的枚举值，而是通过**注册机制**由插件声明
- 每个 WorkMode = 一种 ViewType + 可选 variant 的组合
- 框架不知道有几种 WorkMode，只提供注册接口

---

## 二、注册接口

### 2.1 WorkMode 注册

插件通过注册接口声明一个 WorkMode，框架在 ModeBar 中渲染为一个 Tab。

```typescript
interface WorkModeRegistration {
  id: string;                // 唯一标识，如 'note', 'ai', 'thought'
  viewType: ViewType;        // 打开什么 View
  variant?: string;          // 什么变体（可选）
  icon: IconDefinition;      // ModeBar Tab 图标
  label: string;             // ModeBar Tab 文字标签
  order: number;             // ModeBar 排列顺序（数字越小越靠前）
}
```

### 2.2 当前注册的 WorkMode

| id | viewType | variant | ModeBar 显示 | NavSide 内容 |
|----|----------|---------|-------------|-------------|
| `note` | `note` | — | Note | 笔记目录 |
| `pdf` | `pdf` | — | PDF | PDF 文档列表 |
| `web` | `web` | — | Web | 书签/历史 |
| `ai` | `web` | `ai` | AI | 对话历史 |
| `graph` | `graph` | — | Graph | 图谱入口 |

> 未来新增 WorkMode = 插件注册一个新的 `WorkModeRegistration`，框架不改。
> 例如新增 Thought 独立入口：`{ id: 'thought', viewType: 'note', variant: 'thought', ... }`

---

## 三、驱动关系

WorkMode 驱动两件事：

```
用户在 ModeBar 切换 WorkMode
  │
  ├── 1. NavSide 内容切换
  │     ├── ActionBar → 切换到该 WorkMode 注册的标题和操作按钮
  │     ├── ContentList → 切换到该 WorkMode 注册的渲染器
  │     └── Search → 切换搜索上下文
  │
  └── 2. Left Slot 默认 View
        └── 打开 WorkMode 声明的 viewType + variant
```

### 3.1 WorkMode 不决定什么

- **Right Slot 内容**：Right Slot 由用户操作动态触发（创建批注、打开 PDF、发送到 AI...），不由 WorkMode 预设
- **View 的具体组合**：不存在 `note+pdf`、`pdf+thought` 这样的预定义组合。Slot 布局是用户操作的结果

---

## 四、NavSide 内容注册

同一个 ViewType 的不同 variant 可能需要不同的 NavSide 内容（如 Web 显示书签列表，AI 显示对话历史），因此 NavSide 内容挂在 WorkMode id 上，不是 ViewType 上。

### 4.1 ActionBar 注册

```typescript
interface ActionBarRegistration {
  workModeId: string;           // 挂在哪个 WorkMode 下
  title: string;                // 左侧标题（如"笔记目录"）
  actions: ActionDefinition[];  // 右侧操作按钮
}

interface ActionDefinition {
  id: string;
  icon: IconDefinition;
  label: string;                // tooltip
  handler: () => void;
}
```

### 4.2 ContentList 注册

```typescript
interface ContentListRegistration {
  workModeId: string;           // 挂在哪个 WorkMode 下
  render: (container: HTMLElement) => void;  // 渲染到框架提供的容器
  dispose: () => void;                       // 清理
}
```

---

## 五、与 Workspace 的关系

WorkMode 是 Workspace 的状态：

```typescript
interface WorkspaceState {
  workModeId: string;           // 当前活跃的 WorkMode
  // ...其他 Workspace 状态
}
```

- 每个 Workspace 独立维护自己的 workModeId
- 切换 Workspace 时，NavSide 跟随新 Workspace 的 workModeId 切换内容

---

## 六、ViewType 与 variant

### 6.1 ViewType

```typescript
type ViewType = 'note' | 'pdf' | 'web' | 'graph';
```

ViewType 是框架级的 View 类型分类。每种 ViewType 对应一种独立的 View 实现。

### 6.2 variant

variant 是同一 ViewType 下的行为变体。框架不限制 variant 的取值，由插件自行定义。

| ViewType | variant | 说明 |
|----------|---------|------|
| `note` | — | 标准笔记编辑 |
| `note` | `thought` | 批注模式（锚点绑定、精简 Toolbar） |
| `web` | — | 标准网页浏览 |
| `web` | `ai` | AI 对话模式 |

> variant 的具体行为差异由 View 接口定义文档展开，此处只定义分类关系。

---

## 七、约束（不变量）

1. **注册制**：框架不硬编码任何 WorkMode。所有 WorkMode 通过注册接口声明
2. **id 唯一**：每个 WorkMode 的 id 全局唯一
3. **NavSide 内容挂 WorkMode**：ActionBar、ContentList 的注册以 workModeId 为键，不以 ViewType 为键
4. **WorkMode 不决定 Right Slot**：Right Slot 的内容由用户操作触发，不由 WorkMode 预设
5. **ViewType + variant 可复用**：多个 WorkMode 可以声明相同的 viewType + variant 组合（虽然通常不会这样做）
