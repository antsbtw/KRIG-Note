# KRIG Graph · Pattern + View Mode Spec（B3 草案）

> Pattern Spec v0.1 · 2026-04-28（草案，未定稿）
>
> 作者：wenwu + Claude（讨论中）
>
> 本 spec 是 **Layer 3 知识表示层** 的设计文档，与 [`KRIG-Graph-Import-Spec.md`](./KRIG-Graph-Import-Spec.md)（Layer 1 atom 体系）平级互补。
>
> 设计哲学根源见 [`docs/KRIG-Note-Vision.md`](../KRIG-Note-Vision.md)。
> 本文件中所有设计决定，必须能在愿景文档 §5 的 6 条原则下找到依据。
>
> 本文档为**草案状态**，每节末尾的 ⚠️ 待决议 项需逐条敲定后才能进入实现阶段。

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

### 1.2 数据结构（草案）

```typescript
interface SubstancePattern {
  /** 全局唯一 id，与 substance 命名空间不冲突（约定 'pattern-' 前缀？或独立表？）⚠️ */
  id: string;
  label: string;
  description?: string;

  /** 应用条件：节点引用了这个 pattern（显式声明） */
  // v1：节点的 substance atom 直接引用 pattern id（混用）
  // 或：节点新增 pattern atom，独立于 substance ⚠️ 待决议

  /** 角色定义：声明子节点的"角色名" → "怎么识别这个角色"的映射 */
  roles: Record<string, RoleSelector>;

  /** 布局规则：每个角色摆在哪 */
  layout: PatternLayout;

  /** 自身视觉（继承 v1 SubstanceVisual） */
  visual?: SubstanceVisual;

  // 扩展字段（继承 v1 Substance 的三层架构）
  extends?: string;
  origin?: SubstanceOrigin;
  version?: string;
  pack?: string;
}

/** 角色选择器：怎么从图谱里找出"这个角色"的子节点 */
interface RoleSelector {
  /** 通过哪种关系连到我（predicate id） */
  via: string;        // 例：'contains-navside' or 'contains'
  /** 子节点必须引用的 substance id（可选，进一步缩窄） */
  requires_substance?: string;
  /** 期待 0..1 个还是 0..N 个 */
  arity: 'one' | 'many';
}

/** 布局规则：可以是预设的命名布局（'left/right/top/bottom/center'），
 *  或自定义算法 id（注册到 patternLayoutRegistry） */
type PatternLayout =
  | { kind: 'slots'; assignments: Record<string, SlotPosition> }   // 命名槽位
  | { kind: 'tree'; root_role: string; child_role: string }        // 树形展开
  | { kind: 'custom'; algorithm: string };                         // 自定义

type SlotPosition = 'left' | 'right' | 'top' | 'bottom' | 'center'
                  | { x: number; y: number };  // 自定义偏移
```

### 1.3 一个具体例子：workspace-pattern

```typescript
{
  id: 'pattern-workspace',
  label: 'KRIG Workspace 模式',
  description: 'workspace 节点+navside+slot+ipc+toolbar 的标准布局',

  roles: {
    navside:  { via: 'contains', requires_substance: 'krig-navside',  arity: 'one' },
    slot:     { via: 'contains', requires_substance: 'krig-slot',     arity: 'one' },
    ipc:      { via: 'contains', requires_substance: 'krig-ipc',      arity: 'one' },
    toolbar:  { via: 'contains', requires_substance: 'krig-toolbar',  arity: 'one' },
  },

  layout: {
    kind: 'slots',
    assignments: {
      navside: 'left',
      slot:    'center',
      ipc:     'bottom',
      toolbar: 'top',
    },
  },

  visual: {
    shape: 'rounded-rect',
    fill: { color: '#1a1a2e', opacity: 0.9 },
    border: { color: '#4a4a8a', width: 2, style: 'solid' },
    size: { width: 400, height: 300 },
    labelLayout: 'inside-top',
  },
}
```

任何引用了 `pattern-workspace` 的节点 + 它的 4 类子节点 = 自动按这个范式渲染。

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

### 1.5 ⚠️ 待决议项

1. **Pattern 与 Substance 的命名空间** — 共用？还是 Pattern 独立一个表？
2. **Pattern 的引用方式** — 用现有 `substance` atom 还是新增 `pattern` atom？
3. **Pattern 之间的"继承"是否需要** — 类似 OOP `extends`？v1 是否提供？
4. **匹配冲突** — 一个节点同时满足两个 Pattern 时谁赢？（按引用就不会冲突，按结构推断就会）
5. **缺角色容错** — workspace 没有 toolbar 时怎么办？整体跳到 force 兜底？还是用占位？

---

## 2. View Mode

### 2.1 定义

> **View Mode = 同一份图谱的某种整体视角。**

不同 View Mode 决定：
- 哪些节点 / 边参与显示（filter）
- 节点 / 边怎么排（layout）
- 用什么渲染范式（projection — 节点边视图？树视图？矩阵视图？）
- 交互范式（同 force 视图的拖动 vs 树视图的折叠）

### 2.2 数据结构（草案）

```typescript
interface ViewMode {
  id: string;                  // 'force' / 'tree' / 'matrix' / ...
  label: string;
  description?: string;

  /** 哪些图参与渲染（默认全部） */
  filter?: GraphFilter;

  /** 布局算法 id（注册到 layoutRegistry） */
  layout: string;

  /** 渲染范式：节点-边图 / 树 / 矩阵 / 表格 / ... */
  projection: 'graph' | 'tree' | 'matrix' | 'table' | 'timeline';

  /** 是否启用 Pattern 系统（true=自动按 Pattern 排，false=纯算法布局）⚠️ */
  enable_patterns?: boolean;
}

/** Filter 占位（v1 极简：可见 / 隐藏，按 substance 或 atom 标签） */
interface GraphFilter {
  include_substances?: string[];
  exclude_substances?: string[];
  // ... v1.5+ 支持更复杂的过滤
}
```

### 2.3 v1 内置 View Mode（建议）

| id | 描述 | projection | layout |
|----|------|-----------|--------|
| `force` | 力导节点边图（v1 默认）| graph | force |
| `tree` | 树形层级图（按 contains）| tree | tree-hierarchy |
| `grid` | 网格排布（已实现）| graph | grid |

后续 v1.5+ 加 matrix / timeline / table。

### 2.4 与现有 `active_layout` 的关系

v1.4 已有 `graph.active_layout` 字段。**View Mode 比 active_layout 包了一层**：

```
active_layout = 'force'    ← 现状（只决定位置）
                  ↓ 升级为
view_mode = 'force-default' ← View Mode id
            其内部 layout='force', projection='graph', filter=∅
```

**迁移路径**：v1.4 现有的 layout id 自动包成 View Mode（不破坏现有数据）。

### 2.5 ⚠️ 待决议项

1. **存在哪** — `graph.active_view_mode` 字段？还是 `graph_view_mode` 表（多 View Mode 并存）？
2. **是否每个 graph 都能定义自己的 View Mode**（图谱文件 inline）？还是只用系统级？
3. **projection 是开放枚举还是固定 5 种**？

---

## 3. 渲染合成：Pattern × View Mode

### 3.1 合成顺序（草案）

```
渲染管线（每次 setData 触发）：

  原 atoms
     │
     ▼
  ① 应用 View Mode.filter → 过滤掉不参与渲染的节点
     │
     ▼
  ② 检查 View Mode.enable_patterns
        if true:  按 Pattern 把"满足匹配的节点群"打包，决定群内布局
        if false: 跳过 Pattern，进入步骤 ③
     │
     ▼
  ③ 应用 View Mode.layout 算法 → 算每个节点（或群）的位置
     │
     ▼
  ④ 按 View Mode.projection 渲染
        graph:    现有渲染管线（shape + line + label）
        tree:     缩进+连线
        matrix:   格子
        table:    表格
     │
     ▼
  ⑤ 视觉打磨（边端点裁剪 / 箭头 / z-order，已实现）
```

### 3.2 简化路径（保护现有实现）

v1.4 现有的渲染流程 = `View Mode = force-default` 时步骤 ①filter=∅ + ②enable_patterns=false + ③force layout + ④graph projection + ⑤现有打磨。

**Pattern + View Mode 是叠加在现有管线上，不替换**。

### 3.3 ⚠️ 待决议项

1. **Pattern 算群位置**和 **View Mode 算节点位置**的边界 — 谁先谁后？
2. **没匹配上 Pattern 的节点**怎么办？走原 layout 兜底？还是必须有 Pattern？

---

## 4. 用户扩展机制

### 4.1 三层来源

继承愿景文档与 v1 Substance 三层架构：

| 来源 | Pattern | View Mode |
|------|---------|-----------|
| **base / built-in** | 系统硬编码（v1） | 系统硬编码（force / grid / tree） |
| **图谱文件 inline** | 图谱 .md frontmatter 或独立 atom 段（v1.5+） | 同左 |
| **用户级 / 社区包** | npm 包加载（v2.x+） | 同左 |

### 4.2 v1 范围

只做 base / built-in 层：**系统提供 2-3 个 Pattern + 3 个 View Mode 内置，用户只能选不能创建**。这是为了先把架构验通，再开扩展。

### 4.3 ⚠️ 待决议项

1. **图谱文件 inline 的语法** — frontmatter？独立 atom predicate？
2. **"内置 vs 用户"的覆盖关系** — 用户能覆盖内置同 id 的 Pattern？

---

## 5. 实现路线图（B3 milestone）

```
B3.1 (本文档)  spec 草案              ← in progress
       ↓
       ⚠️ 决议所有"待决议项"
       ↓
B3.2  workspace-pattern 试金石       ← 选 1 个 Pattern 走通管线
       - 数据结构 + Pattern Registry
       - 渲染管线接 Pattern（合成 §3.1）
       - 用 KRIG-Note-Concept.md 验证
       ↓
B3.3  多 View Mode 切换 UI          ← 让用户切 force / tree
       - View Mode Registry
       - graph.active_view_mode 字段
       - tree projection 实现
       - 切换器 UI（顶部 tabs 或下拉）
```

每一步独立 milestone，每一步可独立验证。

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
| 2026-04-28 | v0.1 草案初稿 | B3 milestone 启动；待 wenwu review 后逐条决议 |
