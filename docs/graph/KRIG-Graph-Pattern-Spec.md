# KRIG Graph · Pattern + View Mode Spec

> Pattern Spec v0.3 · 2026-04-28（B3.4 同步版）
>
> 作者：wenwu + Claude
>
> 本 spec 是 **Layer 3 知识表示层** 的设计文档，与以下文档平级互补：
> - [`KRIG-Graph-Import-Spec.md`](./KRIG-Graph-Import-Spec.md) — Layer 1 atom 体系
> - [`KRIG-Graph-Layout-Spec.md`](./KRIG-Graph-Layout-Spec.md) — 布局引擎（ELK）
>
> 设计哲学根源见 [`docs/KRIG-Note-Vision.md`](../KRIG-Note-Vision.md)。
> 本文件中所有设计决定，必须能在愿景文档 §5 的 6 条原则下找到依据。
>
> v0.3 状态：B3.4 决策（引入 ELK 替换手写布局）已落入 §5 路线图与 §2.6 projection 节。

---

## 0. 本 spec 的定位

### 0.1 与既有 spec 的边界

```
┌──── Layer 1: 知识图谱容器（已实现 v1.4） ──┐
│ KRIG-Graph-Import-Spec.md                 │
│   - graph_geometry / atom 数据模型         │
│   - Substance Library（物质库基础）       │
│   - 布局算法接口（force / grid）          │
│   注：v1.4 实现的是"容器"，内容靠 L2 填充 │
└────────────────────────────────────────┘
                  ↑ 内容来自
┌──── Layer 2: 知识内容填充（v2.0+） ───────┐
│ KRIG-Graph-Layer2-Vision.md（占位）        │
│   - AI 抽取笔记 / 公共图谱 / 手动           │
│   - 调外部 API，KRIG 不自建 NLP            │
└────────────────────────────────────────┘
                  ↑ 派生表达
┌──── Layer 3: 知识表示（本 spec） ─────────┐
│ KRIG-Graph-Pattern-Spec.md                │
│   - Substance Pattern（结构模式）          │
│   - View Mode（视图模式）                  │
│   - 用户扩展机制                           │
└────────────────────────────────────────┘
```

**B3（本 spec）和 Layer 2 互不阻塞**：B3 完成 KRIG 能"美化空图谱"，Layer 2 完成 KRIG 能"长出图谱"，两者叠加才是完整的 KRIG-Note。

### 0.2 解决的问题

愿景文档指出：**同一图谱 → 多种表达**。但具体怎么实现？

需要回答 4 个问题：

1. **怎么把"一类节点 + 它周围的结构"打包成一个可复用单元？** → §1 Substance Pattern
2. **怎么让用户在 force / tree / matrix / timeline 等多种视角间切换？** → §2 View Mode
3. **Pattern × View Mode 如何组合？** → §3 渲染合成
4. **用户怎么创造自己的 Pattern / View Mode？** → §4 扩展机制

### 0.3 不在本 spec 范围

- ❌ AI 自动识别 Pattern（Layer 2 的事，未来 milestone）
- ❌ Pattern 的社区分享 / 包管理（v3.x）
- ❌ 实时协作下 Pattern 的同步语义（v2.x）

---

## 1. Substance Pattern

### 1.1 定义

> **Pattern = "一类节点 + 它周围的关系结构 + 怎么呈现"的封装单元。**

它在概念上**升级**了 v1 的 Substance：

| | v1 Substance（已实现） | Pattern（本 spec 提出） |
|---|---|---|
| 范畴 | 类（CSS class） | 组件（React Component） |
| 控制范围 | 节点自身视觉 | 节点 + 子结构布局 |
| 数据子集 | 一个节点 + 属性 | 一个节点 + 关系网 |
| 例子 | krig-layer / krig-view | workspace-pattern / view-family-pattern |

### 1.2 数据结构（决议 v0.2）

**核心决议（2026-04-28）**：Pattern **不是独立概念**，是 Substance 的扩展形态 —— **命名空间共用**，节点引用方式不变。

#### 1.2.1 Substance 接口扩展

```typescript
interface Substance {
  // v1.4 既有字段（不变）
  id: string;
  label: string;
  description?: string;
  applies_to_kinds?: GeometryKind[];
  visual?: SubstanceVisual;
  extends?: string;
  origin?: SubstanceOrigin;
  version?: string;
  pack?: string;

  // ── B3 Pattern 扩展（仅 Pattern Substance 填）──
  /**
   * 角色定义：从图谱里找出"哪些子节点担当哪个角色"。
   * 简单 Substance 不填；填了就是 Pattern Substance。
   */
  roles?: Record<string, RoleSelector>;

  /**
   * 角色布局规则：每个角色摆在容器内哪个位置。
   * 与 roles 同时填或同时不填。
   */
  pattern_layout?: PatternLayout;
}

/** 角色选择器 */
interface RoleSelector {
  /** 通过哪种关系连到容器节点（predicate id） */
  via: string;
  /** 子节点必须引用的 substance id（可选，进一步缩窄） */
  requires_substance?: string;
  /** 期待 0..1 个还是 0..N 个 */
  arity: 'one' | 'many';
  /**
   * 是否必填（默认 false = 宽容）。
   * - true  ：缺这个角色 → Pattern 整体作废 → 走 fallback layout
   * - false ：缺这个角色 → 槽位留空，Pattern 仍然生效
   */
  required?: boolean;
}

/** 角色布局规则 */
type PatternLayout =
  | { kind: 'slots'; assignments: Record<string, SlotPosition> }   // 命名槽位
  | { kind: 'tree'; root_role: string; child_role: string }        // 树形展开
  | { kind: 'custom'; algorithm: string };                         // 自定义算法 id

type SlotPosition = 'left' | 'right' | 'top' | 'bottom' | 'center'
                  | { x: number; y: number };  // 自定义偏移
```

#### 1.2.2 节点引用方式（不变）

节点通过现有 `substance` intension atom 引用 — 简单 Substance 和 Pattern Substance **走同一条路径**：

```
{ subject: 'g-workspace-1',
  predicate: 'substance',
  value: 'pattern-workspace',     // ← 引用 Pattern Substance
  value_kind: 'ref' }
```

渲染管线读到引用 → 查 `substanceLibrary.get(id)` → 检查 `substance.roles` 是否存在：
- **存在** → 走 Pattern 渲染路径（角色匹配 + 布局）
- **不存在** → 走传统 Substance 路径（v1.4 行为）

#### 1.2.3 命名约定（建议，非强制）

```
简单 Substance：     krig-* / domain-*
Pattern Substance：  pattern-*
关系 Substance：     relation-*
```

前缀仅为可读性，不影响匹配机制。

#### 1.2.4 这个决议的好处

| 维度 | 收益 |
|------|------|
| 用户心智 | 只学一个概念"substance"，复杂度按需揭示 |
| v1.4 兼容 | 既有 5 个 Substance 不需要改 |
| 引用机制 | `substance` predicate 复用，不增加新 atom 类型 |
| 视觉合成 | 没有"双重引用"冲突（Pattern 即 Substance，不会和别的 Substance 打架） |
| 演化路径 | 任何简单 Substance 都可以"升级"为 Pattern（加 roles 字段即可） |

### 1.3 一个具体例子：workspace-pattern

```typescript
// 通过 substanceLibrary.register({...}) 注册 — 与简单 Substance 走同一入口
{
  id: 'pattern-workspace',
  label: 'KRIG Workspace 模式',
  description: 'workspace 节点+navside+slot+ipc+toolbar 的标准布局',

  // ── 自身视觉（容器外观，与简单 Substance 一样）──
  visual: {
    shape: 'rounded-rect',
    fill: { color: '#1a1a2e', opacity: 0.9 },
    border: { color: '#4a4a8a', width: 2, style: 'solid' },
    size: { width: 400, height: 300 },
    labelLayout: 'inside-top',
  },

  // ── Pattern 扩展：roles + pattern_layout（有了它们，这就是 Pattern Substance）──
  roles: {
    navside:  { via: 'contains', requires_substance: 'krig-navside',  arity: 'one' },
    slot:     { via: 'contains', requires_substance: 'krig-slot',     arity: 'one' },
    ipc:      { via: 'contains', requires_substance: 'krig-ipc',      arity: 'one' },
    toolbar:  { via: 'contains', requires_substance: 'krig-toolbar',  arity: 'one' },
  },

  pattern_layout: {
    kind: 'slots',
    assignments: {
      navside: 'left',
      slot:    'center',
      ipc:     'bottom',
      toolbar: 'top',
    },
  },
}
```

任何引用了 `pattern-workspace` 的节点（即 `substance: pattern-workspace` atom 存在）+ 它的 4 类子节点 = 自动按这个范式渲染。

### 1.4 嵌套：层层渲染

> "Workspace 里的 Slot 装 View，View 自己也有 view-pattern"

嵌套规则（v1 简化版）：

- **外层 Pattern 决定 Slot 在哪**（容器位置）
- **内层 Pattern 在 Slot 范围内自决**（容器内布局）
- 外层不能越级控制内层节点的细节布局

```
pattern-workspace
  ├ navside (krig-navside)
  ├ slot    (krig-slot)
  │   └─ 子节点引用 pattern-view-family
  │       ├ ...           ← view-family-pattern 决定这层怎么排
  │       └ ...
  ├ ipc
  └ toolbar
```

### 1.5 视觉合成的边界（决议 v0.2）

**核心决议（2026-04-28）**：**外层 Pattern 只决定子节点位置，不动子节点视觉**。

每个节点的视觉（shape / fill / border / size / labelLayout）**完全由它自己的 substance 决定**。外层 Pattern 不能 override 子节点的视觉字段。

#### 为什么

| 论点 | 解释 |
|------|------|
| 职责分离 | Pattern 是"布局组件"，Substance 是"样式组件"；类比 React，父组件传 size/position，子组件管 className |
| 图谱客观性 | 节点的 substance atom 是事实声明（"我是 krig-slot，所以我长这样"）；外层不该篡改 |
| 用户心智可预测 | 看到节点 substance 即知节点视觉，无需追溯外层 Pattern |
| v1.4 兼容 | 现有的 substance.visual 合成逻辑不受 Pattern 影响 |

#### 用户想个性化怎么办

通过 v1.4 已有的 **presentation atom** 机制，对**具体实例**调整视觉：

```
{ subject: 'g-slot-1', layout_id: 'force', attribute: 'fill.color', value: '#000', ... }
```

这是单个实例的覆盖，不是 Pattern 集体性 override。

### 1.6 角色匹配的容错（决议 v0.2）

**核心决议（2026-04-28）**：通过 `RoleSelector.required` 字段声明式控制。**默认 false（宽容）**。

#### 判定逻辑

对于一个引用了 Pattern Substance 的容器节点：

```
1. 遍历 pattern.roles，按 selector.via / requires_substance 在图谱里匹配子节点
2. 检查每个 required: true 的角色：
     找到 → 通过
     没找到 → Pattern 整体作废 → 该容器节点走 fallback layout（force）
3. 所有 required 角色都通过 → Pattern 生效，required: false 缺失的角色留空槽位
```

#### 例子

```typescript
roles: {
  slot:     { via: 'contains', requires_substance: 'krig-slot',    arity: 'one', required: true  },
  navside:  { via: 'contains', requires_substance: 'krig-navside', arity: 'one', required: false },
  ipc:      { via: 'contains', requires_substance: 'krig-ipc',     arity: 'one', required: false },
  toolbar:  { via: 'contains', requires_substance: 'krig-toolbar', arity: 'one', required: false },
}
```

| 实际图谱 | 行为 |
|---------|------|
| 4 个角色全有 | Pattern 完整生效 |
| 缺 toolbar（required: false） | Pattern 生效，toolbar 槽位空着 |
| 缺 navside + ipc | Pattern 生效，两个槽位空着 |
| **缺 slot（required: true）** | Pattern 整体作废 → 走 force layout |

#### 为什么默认 false

- v1 用户写 Pattern 容易忘加 required，宽容默认更不易出错
- "必填"是更强的约束，应当显式声明
- 缺一两个可选角色时仍能渲染，比"完全不展示"用户体验好

### 1.7 Pattern extends（v1 不提供）

**核心决议（2026-04-28）**：v1 **不实现** Pattern 之间的继承（`extends` 字段）。

接口字段 `extends?: string` 在 v1.4 Substance 接口里**已预留**（语义层面），v1 解析器**忽略**该字段（不报错也不生效）。

#### 为什么暂不做

| 论点 | 解释 |
|------|------|
| 语义复杂 | roles / pattern_layout / visual 各有合并规则，相互交织 |
| 多级继承坑深 | A extends B extends C 的字段合并指数级复杂 |
| v1 没场景压力 | 内置 Pattern ≤ 5 个，独立写一份完全可承受 |
| 接口预留即可 | 数据 schema 不需要改，未来扩展不破兼容 |

留 v1.5+ 当真有"批量微调 Pattern"需求时再设计继承语义。

### 1.8 决议状态

| # | 主题 | 状态 | 决议 |
|---|------|------|------|
| 1 | Pattern 与 Substance 命名空间 | ✅ 2026-04-28 | **共用** — Pattern 是 Substance 的扩展形态（详见 §1.2） |
| 2 | Pattern 引用方式 | ✅ 2026-04-28 | **沿用 `substance` atom** — 渲染管线靠 `substance.roles` 区分（详见 §1.2.2） |
| 3 | Pattern 之间的继承 | ✅ 2026-04-28 | **v1 不提供**，接口预留 `extends` 字段（详见 §1.7） |
| 4 | 视觉冲突仲裁 | ✅ 2026-04-28 | **子节点 substance 优先**；外层 Pattern 只管位置不管视觉（详见 §1.5） |
| 5 | 缺角色容错 | ✅ 2026-04-28 | **`RoleSelector.required` 字段，默认 false**（详见 §1.6） |

---

## 2. View Mode

### 2.1 定义

> **View Mode = 同一份图谱的某种整体视角。**

不同 View Mode 决定：
- 哪些节点 / 边参与显示（filter）
- 节点 / 边怎么排（layout）
- 用什么渲染范式（projection — 节点边视图？树视图？矩阵视图？）
- 交互范式（同 force 视图的拖动 vs 树视图的折叠）

### 2.2 数据结构（决议 v0.2）

```typescript
interface ViewMode {
  id: string;                  // 'force' / 'tree' / 'grid' / ...
  label: string;
  description?: string;

  /** 哪些图参与渲染（默认全部） */
  filter?: GraphFilter;

  /** 布局算法 id（注册到 layoutRegistry） */
  layout: string;

  /**
   * 渲染范式 id（注册到 projectionRegistry）。
   * v1 内置 'graph'；后续注册 'tree' / 'matrix' / 'timeline' / 'table' 等。
   */
  projection: string;

  /** 是否启用 Pattern 系统（true=自动按 Pattern 排，false=纯算法布局） */
  enable_patterns?: boolean;
}

/** Filter（v1 极简：按 substance 包含/排除） */
interface GraphFilter {
  include_substances?: string[];
  exclude_substances?: string[];
  // v1.5+ 支持更复杂的过滤（按 atom 标签 / 关系类型 / ...）
}
```

### 2.3 v1 内置 View Mode

| id | 描述 | projection | layout |
|----|------|-----------|--------|
| `force` | 力导节点边图（v1 默认）| `graph` | `force` |
| `tree` | 树形层级图（按 contains）| `tree` | `tree-hierarchy` |
| `grid` | 网格排布（已实现）| `graph` | `grid` |

后续 v1.5+ 加 matrix / timeline / table。

### 2.4 存储位置（决议 v0.2）

**核心决议（2026-04-28）**：v1 在 `graph` 主表加单字段 `active_view_mode`，**不引入** `graph_view_mode` 表。

```sql
-- v1.4 现状
graph: id, title, dimension, active_layout, ...

-- v1.5 B3 扩展
graph: id, title, dimension, active_layout, active_view_mode, ...
                                            ↑ 新增字段
```

#### 为什么单字段而非表

| 论点 | 解释 |
|------|------|
| v1 内置 3 种 ViewMode 够用 | 用户切 force / tree / grid 即可，不需要"创建多个自定义 ViewMode" |
| 实现极简 | 只加一个 string 字段，迁移零成本 |
| 不阻塞未来 | v1.5+ 真有"用户自创多 ViewMode"需求时，把单字段升级为引用 `graph_view_mode` 表（迁移：当前值视为唯一记录） |

#### 与 `active_layout` 的关系

v1.4 的 `active_layout` **不删**，作为 ViewMode 内部的 layout 字段的"快捷投影"：

```
graph.active_view_mode = 'force'         ← 用户在 UI 切的
                ↓
viewModeRegistry.get('force').layout = 'force'  ← 实际算位置用的
                ↓
graph.active_layout 同步更新为 'force'    ← 兼容 v1.4 既有代码
```

迁移路径：升级 schema 时给所有现有 graph 的 `active_view_mode` 自动设为对应的 `active_layout`，零数据丢失。

### 2.5 图谱文件 inline ViewMode（v1 不提供）

**核心决议（2026-04-28）**：v1 **只支持系统级 ViewMode**（注册到 `viewModeRegistry`）。图谱文件不能 inline 定义自己的 ViewMode。

#### 为什么暂不做

| 论点 | 解释 |
|------|------|
| v1 没有 UI 入口 | 用户只能切换内置 ViewMode，不能创建 |
| 图谱级 ViewMode 涉及 schema 扩展 | 需要 `graph_view_mode` 表 + 图谱文件 frontmatter 语法 |
| 内置 3 个先验证架构 | force / tree / grid 跑通后再开扩展 |

v1.5+ 路径：当 `graph_view_mode` 表加入时，图谱文件可通过 frontmatter 或独立 atom 段声明自定义 ViewMode（与图谱级 substance 同等待遇 — 见 memory `project_graph_file_self_contained.md`）。

### 2.6 projection 开放注册（决议 v0.2 + B3.4 增补）

**核心决议（2026-04-28）**：`projection` 是**开放字符串 id**，注册到 `projectionRegistry`，与 `layoutRegistry` 同构。

#### 注册表设计

```typescript
interface Projection {
  id: string;                       // 'graph' / 'tree' / 'matrix' / ...
  label: string;
  description?: string;
  /**
   * B3.4 新增：边路由风格 hint。
   * tree projection 取 'orthogonal'；splines 等留 v1.9+。
   * 详见 KRIG-Graph-Layout-Spec.md §5
   */
  edgeStyle?: 'orthogonal' | 'splines' | 'polyline' | 'straight';
  /**
   * B3.4 新增：让 projection 介入边渲染。
   * 输入：line instance + 由 LayoutOutput.edgeSections 暂存的 ELK 边路由数据
   * 输出：替代直线的折线/曲线点序列；返回 null 走原直线
   */
  customizeLine?(
    inst: RenderableInstance,
    edgeSections: EdgeSection[] | undefined,
  ): THREE.Vector3[] | null;
}
```

#### v1.7 → v1.8 注册的 projection

| id | 状态 | edgeStyle | layout 数据来源 |
|----|------|----------|---------------|
| `graph` | v1.4 实现 | straight | layout positions（无 sections） |
| `tree` | **v1.8 B3.4 实现** | orthogonal | ELK mrtree 输出的 edge sections |

后续 milestone 注册：
- `'matrix'`：N×N 格子热图（v1.9+）
- `'timeline'`：时间轴 + 事件（v1.9+）
- `'table'`：表格视图（用 NoteView 的 table block？或独立实现）

#### 为什么开放

| 论点 | 解释 |
|------|------|
| 与 layoutRegistry 一致 | v1.4 的 layout 已是开放注册表，本机制对齐 |
| 加新 projection 不破坏 spec | 注册一行代码，不需要改类型定义或本 spec |
| 未来支持社区贡献 projection | v3.x 路径，但接口已就位 |

### 2.7 决议状态

| # | 主题 | 状态 | 决议 |
|---|------|------|------|
| 6 | ViewMode 存储位置 | ✅ 2026-04-28 | **`graph.active_view_mode` 单字段**（详见 §2.4） |
| 7 | 图谱文件 inline ViewMode | ✅ 2026-04-28 | **v1 不提供**（v1.5+ 走 graph_view_mode 表）（详见 §2.5） |
| 8 | projection 开放枚举 | ✅ 2026-04-28 | **开放字符串 + projectionRegistry**（详见 §2.6） |

---

## 3. 渲染合成：Pattern × View Mode

### 3.1 合成顺序（决议 v0.2）

**核心决议（2026-04-28）**：**Pattern 先算群位置，ViewMode 兜底剩余节点**。Pattern 管"群内布局"（局部），ViewMode 管"群间布局"（整体）。

```
渲染管线（每次 setData 触发）：

  原 atoms
     │
     ▼
  ① 应用 ViewMode.filter → 过滤掉不参与渲染的节点
     │
     ▼
  ② 扫描 Pattern Substance 容器
        for each 节点 n with substance.roles 存在：
          - 按 roles 在图谱里匹配子节点
          - required 角色全找到 → 按 pattern_layout 算群内子节点位置
          - required 角色缺失 → 该容器作废（走 ③ 兜底）
        嵌套递归（内层 Pattern 在外层划定的容器空间内自决）
     │
     ▼
  ③ ViewMode.layout 兜底剩余节点
        输入：
          - Pattern 容器节点（看作单个节点，位置由它决定）
          - 没归属任何 Pattern 的"散户"节点
        统一交给 ViewMode.layout 算位置
     │
     ▼
  ④ ViewMode.projection 渲染
        'graph':    现有渲染管线（shape + line + label，v1.4 已实现）
        'tree':     缩进 + 父子连线（v1.5+ 加）
        ...
     │
     ▼
  ⑤ 视觉打磨（边端点裁剪 / 箭头 / z-order，已实现 v1.5）
```

#### 为什么 Pattern 先

| 论点 | 解释 |
|------|------|
| 职责清晰 | Pattern 管局部，ViewMode 管整体；分层不重叠 |
| 避免视觉抖动 | 如果 ViewMode 先算所有节点，再 Pattern 强行收回 → 节点会"先散后聚"明显跳动 |
| 性能更好 | Pattern 处理后，ViewMode.layout 输入节点数减少（容器看作 1 个） |
| 嵌套自然 | 外层 Pattern 划定容器空间 → 内层 Pattern 在内部自决（详见 §1.4） |

### 3.2 散户处理（决议 v0.2）

**核心决议（2026-04-28）**：没匹配上 Pattern 的节点（**散户**）和 **Pattern 容器自身**一起走 ViewMode.layout，与 v1.4 行为一致。

```
ViewMode.layout 输入 = (Pattern 容器节点们) ∪ (散户节点们)
                          ↑                        ↑
                          位置代表整个群            自由布局
```

#### 例子

```
图谱有 100 个节点：
  - 5 个 workspace 容器（substance: pattern-workspace）
    - 各自包含 navside / slot / ipc / toolbar 共 20 个子节点
  - 75 个散户节点（普通 substance，没 Pattern）

渲染：
  ② Pattern 处理：5 个容器内的 20 个子节点位置由 pattern_layout 算
  ③ ViewMode.layout 处理：5 个容器（看作单点）+ 75 个散户 = 80 个顶级节点
        force 算法把这 80 个排开
  ④ projection 渲染所有 100 个节点
```

#### 为什么这样

- 与 v1.4 兼容（v1.4 所有节点都走 layout，等同于"全是散户"）
- 不强制用户给所有节点都加 Pattern
- 与 §3.1 决议"ViewMode 兜底"一致

### 3.3 简化路径（保护现有实现）

v1.4 现有的渲染流程 = `ViewMode = 'force'` 时：
- ① filter = ∅
- ② 没有 Pattern Substance（5 个内置 substance 都没 roles）→ 全部走兜底
- ③ force layout 算所有节点位置
- ④ 'graph' projection 渲染
- ⑤ v1.5 视觉打磨

**Pattern + ViewMode 是叠加在现有管线上，不替换**。v1.4 → v1.5 升级时，行为完全等价。

### 3.4 决议状态

| # | 主题 | 状态 | 决议 |
|---|------|------|------|
| 9 | Pattern vs ViewMode 优先级 | ✅ 2026-04-28 | **Pattern 先算群位置，ViewMode 兜底**（详见 §3.1） |
| 10 | 没匹配上 Pattern 的节点 | ✅ 2026-04-28 | **散户走 ViewMode.layout**，与 v1.4 一致（详见 §3.2） |

---

## 4. 用户扩展机制

### 4.1 三层来源

继承愿景文档与 v1 Substance 三层架构：

| 来源（origin） | Pattern | ViewMode | 加载顺序 |
|------|---------|-----------|---------|
| `base` | 系统硬编码基类（不可删/改） | 系统硬编码基类 | 1 |
| `built-in` | KRIG 内置 Pattern（v1） | 内置 ViewMode（v1） | 2 |
| `theme` | 主题包（仅改视觉，不改语义） | 主题包 | 3 |
| `community` | 第三方 npm 包（v2.x+） | 同左 | 4 |
| `user` | 用户本地 JSON / 图谱文件 inline（v1.5+） | 同左 | 5 |

### 4.2 v1 范围

只做 `base` + `built-in` 层：**系统提供 2-3 个 Pattern + 3 个 ViewMode 内置，用户只能选不能创建**。这是为了先把架构验通，再开扩展。

### 4.3 覆盖语义（决议 v0.2）

**核心决议（2026-04-28）**：**按 origin 加载顺序，后注册者覆盖同 id 前者**。

```
加载顺序：base → built-in → theme → community → user
                                                    ↑
                                                后者赢
```

#### 实现细节

- `substanceLibrary.register({ id, ... })` 按 origin 顺序加载
- 同 id 重复注册：保留**最后一次**注册的版本（即最高 origin）
- 用户改了内置 Pattern 时，UI 提示"该 Pattern 已被用户覆盖（origin: user）"
- 通过"重置为默认"按钮可恢复 built-in 版本

#### v1 实际行为

v1 仅有 `base` + `built-in`，**覆盖机制接口预留但不实际触发**（不会出现同 id 冲突）。
v2.x 加 `user` / `community` 时机制自然生效。

#### 为什么允许覆盖

| 论点 | 解释 |
|------|------|
| 愿景一致 | §5.4 "用户能创造视图模式"是核心原则；覆盖是创造的延伸 |
| 与 v1.4 Substance 一致 | `SubstanceOrigin` 已规划同样的层级语义（见 [substance/types.ts:79](../../src/plugins/graph/substance/types.ts#L79)） |
| 用户魔改空间 | 调整 workspace 槽位布局是合理需求 |
| 风险可控 | UI 警告 + 一键重置 |

### 4.4 决议状态

| # | 主题 | 状态 | 决议 |
|---|------|------|------|
| 11 | 用户覆盖内置 Pattern | ✅ 2026-04-28 | **按 origin 加载顺序覆盖**（v1 接口预留，v2.x 实际生效）（详见 §4.3） |

---

## 5. 实现路线图（B3 milestone）

```
B3.1 (本文档)  spec v0.2 决议版              ← ✅ 完成（11/11 决议，2026-04-28）
       ↓
B3.2  workspace-pattern 试金石               ← ✅ 完成（v1.6-graph-pattern, 2026-04-28）
       - Substance 接口扩展（roles + pattern_layout）  ✓
       - Pattern 渲染管线（§3.1 ② 步）  ✓
       - 内置 pattern-workspace + 4 个角色子 substance  ✓
       - 端到端验证（docs/graph/samples/Workspace-Pattern-Test.md）  ✓
       ↓
B3.3  多 ViewMode 切换 UI                   ← ✅ 完成（v1.7-graph-viewmode, 2026-04-28）
       - viewModeRegistry + projectionRegistry  ✓
       - graph.active_view_mode 字段（schemaless 兼容）  ✓
       - tree-hierarchy layout（手写 BFS + 字典序，B3.4 将替换为 ELK mrtree）  ✓
       - 切换器 UI（顶部 tabs：力导/层级树/网格）  ✓
       - 注：tree projection（真树形连线）留 B3.4，B3.3 用 graph projection 占位
       - 副作用修复：fitToContent 加 NaN 防御（feedback memory 已记）
       ↓
B3.4  Tree projection + ELK 布局体系换芯     ← 🚧 进行中（feature/graph-elk-layout）
       决策依据：KRIG-Graph-Layout-Spec.md（2026-04-28）
       核心决策：① 引入 elkjs 替换 force/grid/tree-hierarchy 三个手写算法
                  graph 模块实验阶段，无外部用户依赖现行 layout 行为
                  是替换技术债的最佳时机
                ② label-aware sizing：异步测量 SVG label 真实 bbox 持久化到
                  presentation atom，layout 用真实尺寸排版。一次到位不留技术债。
       ─ B3.4.1  elkjs 依赖 + WebWorker 单例 + LayoutAlgorithm 异步化（含 measureLabel）
       ─ B3.4.2  force/grid/tree 三算法换芯到 ELK（force/box/mrtree）
       ─ B3.4.3  tree projection 注册（ORTHOGONAL 边路由）
       ─ B3.4.4  LineSegmentShape 多点折线支持
       ─ B3.4.5  label-aware sizing（presentation atom + label-measurer + getInstanceBoxSize）

B3.1-B3.3 已交付；B3.4 完成后整个 B3 milestone 闭合。
```

每一步独立 milestone，每一步独立验证 + tag。

---

## 6. 与愿景的对应关系

| 愿景原则 | 本 spec 对应实现 |
|---------|---------------|
| §5.1 图谱面向机器 / 视图面向人 | Pattern + View Mode 都是 Layer 3 概念，不影响 atom |
| §5.2 关系是资产 / 视图是消耗品 | Pattern / View Mode 可随时增删改，atom 不受影响 |
| §5.3 一图多表 | View Mode 多个并存，用户随时切换 |
| §5.4 用户能创造视图模式 | §4 扩展机制（v1 仅 built-in，预留 inline + 社区） |
| §5.5 媒介定位 | Pattern 让"知识结构"成为可视化范式 |
| §5.6 视图是双向接口 | Pattern 在拖动 / 编辑下应能触发 atom 反向更新（§3.1 之后的扩展） |

---

## 7. 修订历史

| 日期 | 修订 | 触发 |
|------|------|------|
| 2026-04-28 | v0.1 草案初稿 | B3 milestone 启动 |
| 2026-04-28 | v0.2 决议版 | 11 个待决议项分 4 组逐条决议（详见各节"决议状态"表）；可进入 B3.2 实现 |
| 2026-04-28 | §5 路线图状态更新 | B3.2 + B3.3 完成（v1.6 + v1.7 已 tag） |
| 2026-04-28 | v0.3 B3.4 同步版 | 新增 KRIG-Graph-Layout-Spec.md；§2.6 projection 接口扩展 edgeStyle / customizeLine；§5 路线图加 B3.4 ELK 换芯 |
| 2026-04-28 | v0.3.1 加 B3.4.5 | wenwu 决策 label-aware sizing 一次到位（方案 C）；§5 加 B3.4.5 阶段 |
