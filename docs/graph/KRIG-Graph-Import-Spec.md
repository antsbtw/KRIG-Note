# KRIG Graph 数据模型 + 导入功能 Spec

> **版本**：v1.4 候选主题 #1（数据模型重构 + Markdown 导入）
> **目标**：建立 KRIG Graph 的核心数据模型——四态分立架构（数学态 / 物理态 / 语义态 / 视觉态），并通过 Markdown 导入功能验证。
> **状态**：草案 v4（重写：加入 Substance Library 物质库 + 数学态/物理态分立）
> **创建**：2026-04-26
> **更新**：2026-04-26 — 引入 Substance Library 物质库，确立四态分立架构

---

## 0. 背景与定位

### 0.1 关键认知

KRIG Graph 不是"画布"，而是**知识图谱**。这意味着：

| 维度 | 知识图谱 | 画布 |
|---|---|---|
| 数据模型 | 拓扑 + 语义 atom + 视觉 atom + 物质引用 | 拓扑 + 几何 + 样式硬编码 |
| 位置由谁定 | 算法 + 用户局部覆盖 | 用户全权 |
| 同一数据可视化 | 多布局自由切换 | 唯一布局 |
| 几何元素 | Point / Line / Surface / Volume（4 种） | 节点 / 边（2 种） |
| 视觉一致性 | 物质引用自动保证 | 用户手工调整 |
| 用户心智 | "这是知识结构" | "这是我画的图" |

### 0.2 四态分立架构（核心）

KRIG Graph 把一个可见对象拆解为四种正交的"态"，分别持久化、独立演化：

```
Mathematical Form    数学态   →  Geometry           几何骨架（不变结构）
Physical Substance   物理态   →  Substance Library  物质库（客观世界投射）
Semantic Description 语义态   →  Intension Atom     视图内涵（语义描述）
Visual Override      视觉态   →  Presentation Atom  视图属性（视觉覆盖）
```

**四态对应**（康德式区分）：
- **Geometry（数学态）** — 纯抽象结构（圆、线、面、体）。"这个东西占据什么形状的空间"
- **Substance（物理态）** — 客观世界的物质 / 实体（钻石、水、KRIG-Layer、Concept）。"这个东西本质上是什么"
- **Intension（语义态）** — 关于这个东西的描述、关系、标签。"这个东西被人类如何理解"
- **Presentation（视觉态）** — 视觉覆盖 + 用户位置意图。"这个东西在当前场景下被如何呈现"

**渲染合成**：
```
最终可见对象 = Geometry 形状 + Substance.visual 默认 + Presentation 覆盖 + 运行时位置
```

### 0.3 核心架构原则

本 spec 落地遵循 5 条原则：

1. **四态分立** — 数学 / 物理 / 语义 / 视觉各管一摊，正交独立
2. **几何体一等公民** — Point / Line / Surface / Volume 是统一的几何抽象，不是"节点 + 边"特例
3. **持久化最小化** — 只存"用户表达的意图" + "无法重新计算的事实"，所有衍生数据由算法实时算出
4. **物质即领域知识** — Substance Library 不只是视觉模板，是 domain knowledge 的容器（钻石的密度是事实，不是视觉选择）
5. **分层注册化** — 布局算法、关系类 predicate、几何 kind、物质、value_kind 推断器都通过注册表使用，不硬编码

### 0.4 不在本 spec 范围

- 推理（subClassOf 传递、属性继承）
- 跨图谱链接
- 3D 渲染（数据模型支持，渲染层 v2.0）
- Volume 几何体的渲染（数据模型支持，v1 留占位）
- Substance 物理属性驱动力导（数据结构留出，v3.0 实施）
- AnnotationPanel UI（v1 只导入数据，详情面板 v1.5）
- 力导之外的布局算法（v1 仅 force / grid / manual）
- 用户自定义 Substance 编辑 UI（v2.x）

---

## 1. 数据模型（核心）

### 1.0 模型概览

```
一张图的持久化数据 = 骨架 + 视图内涵 Atom + 视图属性 Atom
+ 引用的物质库（声明式资源，加载时注册）

  Skeleton（骨架 — 数学态）
    ├── graph                       图元数据
    └── graph_geometry              所有几何体（point/line/surface/volume）

  Intension Atom（视图内涵 — 语义态）
    └── graph_intension_atom        语义属性集合，挂在几何体上

  Presentation Atom（视图属性 — 视觉态）
    └── graph_presentation_atom     视觉属性集合，挂在几何体上，按 layout 分组

  Substance Library（物质库 — 物理态，声明式资源）
    └── 不在 DB，是代码 / JSON 形式的可注册资源
        几何体通过 intension atom `substance :: id` 引用
```

**关键性质**：
- 每个几何体只有 `id` + `kind` + `members`（拓扑骨架）
- 它的标签、类型、描述、关系全在 intension atom 里
- 它的位置、覆盖颜色等全在 presentation atom 里
- 它引用的物质（visual 默认值 + physical / chemical 知识）通过 substance 引用获得
- 几何体 + 三种 atom + 物质 = 完整的"数学/物理/语义/视觉"四态对象

### 1.1 `graph` 主表

```typescript
interface GraphRecord {
  id: string;
  title: string;
  variant: string;                 // 'knowledge' / 'mindmap' / ...
  dimension: 2 | 3;                // 图谱维度（v1 仅 2）
  active_layout: string;           // 'force' / 'grid' / 'manual' / 'tree' / ...
  host_note_id: string | null;
  folder_id: string | null;
  created_at: number;
  updated_at: number;
}
```

新增字段：
- **`dimension`**：决定 `position.z` 是否生效，决定渲染引擎选择 2D / 3D
- **`active_layout`**：当前激活的布局算法 id

### 1.2 `graph_geometry`（数学态：几何体统一表）

**v1.3 的 `graph_node` / `graph_edge` 合并成单表** —— 所有几何体共享 schema：

```typescript
interface GraphGeometryRecord {
  id: string;
  graph_id: string;
  kind: GeometryKind;              // 'point' | 'line' | 'surface' | 'volume'
  members: string[];               // 引用下层几何体的 id 列表
  created_at: number;
}

type GeometryKind = 'point' | 'line' | 'surface' | 'volume';
```

**几何体类型学（数学结构）**：

| kind | 维度 | members 含义 | 拓扑约束 | 知识图谱意义 |
|---|---|---|---|---|
| `point` | 0D | 无（始终 `[]`） | `members.length === 0` | 单一概念 / 实体 / 事实 |
| `line` | 1D | 端点 Point id | `length ≥ 2`（≥3 是折线） | 概念间的关系 |
| `surface` | 2D | 顶点 Point id | `length ≥ 3`（围成区域） | 概念集合 / 范畴 / 主题域 |
| `volume` | 3D | 边界 Surface id | `length ≥ 4`（围成立体） | 嵌套子图 / 模块 / 命名空间 |

**架构对称性**：
- 几何体 N+1 维由 N 维成员围成
- v1 简化：Surface 直接由 Points 围成（不引入"先 Line 后 Surface"的层级）

**SurrealDB schema**：
```sql
DEFINE TABLE IF NOT EXISTS graph_geometry SCHEMALESS;
DEFINE INDEX IF NOT EXISTS graph_geom_graph ON graph_geometry FIELDS graph_id;
DEFINE INDEX IF NOT EXISTS graph_geom_kind ON graph_geometry FIELDS kind;
```

**关键设计**：
- `kind` 是几何体的本质数学属性（不是 atom，不会变）
- `members` 是骨架（拓扑关系，跨布局不变）
- 标签、类型、视觉等**全在 atom / substance**——几何体本身只表达"数学结构"

### 1.3 Substance Library（物理态：物质库）

#### 1.3.1 设计动机

**几何 = 数学态，物质 = 物理态**：

```
几何（数学态）：圆、方、六边形 —— 抽象形状，与现实无关
物质（物理态）：钻石、水、Concept、Layer —— 客观世界的实体投射
```

```
Geometry（占据什么形状）+ Substance（是什么）= 可见对象
        ↓                       ↓
    数学描述                 客观世界投射
```

举例：
- **钻石** 作为 substance 注册一次：`{ visual: ..., physical: { density: 3.51, hardness: 10, refractive_index: 2.42 }, ... }`
- 任何几何体（圆、方、多面体）都可以引用 `substance :: diamond`
- 这一引用同时获得：视觉默认值 + 物理属性 + 化学知识

物质是从客观世界沉淀的**领域知识包**，不是视觉模板。

#### 1.3.2 `Substance` 接口

```typescript
interface Substance {
  id: string;                          // 'diamond' / 'krig-layer' / 'concept-default' ...
  label: string;                       // UI 显示
  description?: string;                // 物质的简介
  applies_to_kinds?: GeometryKind[];   // 限定可被哪些几何引用（默认全部）

  // 视觉投射：substance 的默认渲染参数（presentation atom 可覆盖）
  visual?: {
    shape?: string;                    // 'circle' / 'box' / 'hexagon' / 'sphere' / 'cube' / ...
    fill?: { color?: string; opacity?: number };
    border?: { color?: string; width?: number; style?: 'solid' | 'dashed' | 'dotted' };
    text?: { color?: string; size?: number; font?: string; weight?: number };
    size?: { width?: number; height?: number; depth?: number };
    icon?: string;                     // emoji / SVG path
  };

  // 物理属性（v1 不读，留 v3.0 推理 / 力导驱动用）
  physical?: {
    density?: number;
    hardness?: number;                 // 莫氏硬度等
    mass?: number;                     // 力导权重
    charge?: number;                   // 力导电荷
    transparent?: boolean;
    [key: string]: unknown;            // 自定义物理字段
  };

  // 化学 / 领域属性（v1 不读，留 v3.0 推理 / 搜索用）
  chemical?: {
    formula?: string;
    crystal_system?: string;
    [key: string]: unknown;
  };

  // 行为提示（v1 不读，留 v1.5 交互层用）
  behavior?: {
    clickable?: boolean;
    draggable?: boolean;
    expandable?: boolean;
    [key: string]: unknown;
  };
}
```

**v1 实施只读 `visual` 字段**，其他字段是预留 namespace。

#### 1.3.3 注册表 API

```typescript
// src/plugins/graph/renderer/substance/registry.ts

class SubstanceLibrary {
  register(substance: Substance): void;
  get(id: string): Substance | undefined;
  list(filter?: { kind?: GeometryKind }): Substance[];
}

export const substanceLibrary = new SubstanceLibrary();
```

#### 1.3.4 v1 内置物质清单（覆盖 KRIG-Note-Concept 样本所需）

| id | label | applies_to | visual 概要 |
|---|---|---|---|
| `krig-layer` | KRIG 层级 | point | 六边形 / 深色 / 大字号 |
| `krig-shell-component` | Shell 组件 | point | 圆角矩形 / 蓝灰 |
| `krig-view` | KRIG View | point | 圆 / 蓝色 |
| `krig-concept` | 抽象概念 | point | 圆 / 灰色 |
| `krig-grouping` | 概念集群 | surface | 半透明灰 / 虚线边框 |
| `relation-contains` | 包含关系 | line | 实线 / 黑色 / 箭头朝子 |
| `relation-refs` | 引用关系 | line | 细虚线 / 浅灰 |
| `relation-routes-to` | 通信关系 | line | 点划线 / 蓝色 / 双向箭头 |

#### 1.3.5 引用机制：通过 intension atom

几何体引用物质通过一条特殊的 intension atom：

```
intension atom: { subject: g-app, predicate: 'substance', value: 'krig-layer', value_kind: 'ref' }
```

**`substance` 是保留 predicate**（属于"语义维度的元数据"）。

#### 1.3.6 渲染合成顺序

```
最终视觉参数 = 系统默认值
            ⊕ substance.visual（如果 atom 引用了 substance）
            ⊕ presentation atoms（subject + attribute :: value）
            ⊕ 运行时位置（布局引擎产物）
```

`⊕` = 浅合并，后者覆盖前者。

**示例**：
- 系统默认 fill.color = `#888`
- substance.visual.fill.color = `#1a1a1a`（krig-layer 黑色六边形）
- presentation atom: 无 fill.color 覆盖
- → 最终 `fill.color = #1a1a1a`

如果 presentation atom 写了 `fill.color = '#ff0000'`：
- → 最终 `fill.color = #ff0000`（用户局部覆盖）

#### 1.3.7 物质归属（v2.x）

未来扩展：物质包按领域组织：
- 内置：`built-in/krig-software-domain.ts`（KRIG 自身概念）
- 主题：`themes/paper.ts`（论文风视觉包）
- 用户：`<userdata>/substances/*.json`（用户自定义）
- 第三方：插件贡献

v1 仅内置 1 个 domain pack（krig-software-domain），其他留空。

### 1.4 `graph_intension_atom`（语义态：视图内涵）

```typescript
interface GraphIntensionAtom {
  id: string;
  graph_id: string;
  subject_id: string;              // 任意 graph_geometry.id
  predicate: string;               // 'label' / 'summary' / 'tags' / 'contains' / 'substance' / ...
  value: string;                   // 统一字符串
  value_kind: IntensionValueKind;  // 'text' / 'code' / 'ref' / 'number' / 'url'
  sort_order: number;              // 同 subject + predicate 多值时排序
  created_at: number;
}

type IntensionValueKind = 'text' | 'code' | 'ref' | 'number' | 'url';
```

**SurrealDB schema**：
```sql
DEFINE TABLE IF NOT EXISTS graph_intension_atom SCHEMALESS;
DEFINE INDEX IF NOT EXISTS gia_graph ON graph_intension_atom FIELDS graph_id;
DEFINE INDEX IF NOT EXISTS gia_subject ON graph_intension_atom FIELDS subject_id;
DEFINE INDEX IF NOT EXISTS gia_predicate ON graph_intension_atom FIELDS predicate;
```

**predicate 命名空间**（保留词最少，余者自由）：

| predicate | 含义 | 类别 |
|---|---|---|
| `label` | 几何体的主显示文字 | **保留** |
| `summary` | 一句话摘要（hover 显示） | **保留** |
| `description` | 完整描述 | **保留** |
| `type` | 几何体子类型（'concept' / 'class' / 'event' / ...） | **保留** |
| `substance` | **物质引用**（指向 Substance Library 的 id） | **保留** |
| `tags` | 标签（多值） | 约定 |
| `contains` | 包含关系（同时生成 Line 几何体） | **关系类** |
| `refs` / `references` | 引用关系（同时生成 Line） | **关系类** |
| `routes-to` | 通信路由（同时生成 Line） | **关系类** |
| `defines` | 类型定义（同时生成 Line） | **关系类** |
| `links-to` / `links_to` | 一般链接（同时生成 Line） | **关系类** |
| `boundary` | Surface/Volume 的边界成员（添加到当前几何的 members） | **关系类** |
| 其他（`layer` / `implementation` / 自定义） | 自由扩展 | 自由 |

**关系类 predicate 的"双重身份"**：
- 写 `contains :: [[other-id]]` 时：
  1. 创建一条 intension atom（`subject=this, predicate=contains, value=other-id, value_kind=ref`）
  2. 创建一个 Line 几何体（`kind=line, members=[this-id, other-id]`）
  3. （可选）给该 Line 加 type intension（`subject=line-id, predicate=type, value=contains`）
- 这样**关系既是属性又是几何**，对应 OWL ObjectProperty 的双重性

### 1.5 `graph_presentation_atom`（视觉态：视图属性）

```typescript
interface GraphPresentationAtom {
  id: string;
  graph_id: string;
  layout_id: string;                  // 'force' / 'tree' / '*' （'*' 表跨布局通用）
  subject_id: string;                 // 任意 graph_geometry.id
  attribute: string;                  // 'position.x' / 'fill.color' / 'shape' / ...
  value: string;
  value_kind: PresentationValueKind;
  updated_at: number;
}

type PresentationValueKind = 'number' | 'color' | 'boolean' | 'enum' | 'text';
```

**SurrealDB schema**：
```sql
DEFINE TABLE IF NOT EXISTS graph_presentation_atom SCHEMALESS;
DEFINE INDEX IF NOT EXISTS gpa_graph ON graph_presentation_atom FIELDS graph_id;
DEFINE INDEX IF NOT EXISTS gpa_layout ON graph_presentation_atom FIELDS layout_id;
DEFINE INDEX IF NOT EXISTS gpa_subject ON graph_presentation_atom FIELDS subject_id;
DEFINE INDEX IF NOT EXISTS gpa_attr ON graph_presentation_atom FIELDS attribute;
DEFINE INDEX IF NOT EXISTS gpa_unique ON graph_presentation_atom
  FIELDS graph_id, layout_id, subject_id, attribute UNIQUE;
```

**attribute 命名空间**（用 `.` 分层，类 CSS）：

| 命名空间 | 例 | 含义 |
|---|---|---|
| `position.*` | `position.x` / `position.y` / `position.z` | 位置坐标 |
| `pinned` | `pinned` | 是否固定（true 时算法不重排该几何体的 position） |
| `fill.*` | `fill.color` / `fill.opacity` | 填充覆盖 |
| `border.*` | `border.color` / `border.width` / `border.style` | 边框覆盖 |
| `text.*` | `text.color` / `text.size` / `text.font` | 文字样式覆盖 |
| `size.*` | `size.width` / `size.height` / `size.depth` | 尺寸覆盖 |
| `shape` | `shape` | 形状覆盖 |
| `visible` | `visible` (`'true'` / `'false'`) | 可见性 |
| `opacity` | `opacity` | 整体透明度 |

**`layout_id = '*'` 表跨布局通用**：颜色一旦设定通常不随布局变（除非用户显式不同），所以颜色默认 `layout_id='*'`；位置必然按布局区分。

**v1 实际写入的 attribute**：仅 `position.x` / `position.y` / `pinned`。其他都是预留 namespace。

### 1.6 完整数据模型总览图

```
┌──────────────────────────────────────────────────────────────────┐
│                         持久化（DB）                                │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │  Skeleton（骨架 — 数学态）                                  │     │
│  │                                                           │     │
│  │  graph (id, title, variant, dimension, active_layout)    │     │
│  │     │                                                     │     │
│  │     └─→ graph_geometry (id, kind, members)               │     │
│  │              kind ∈ {point, line, surface, volume}       │     │
│  └─────────────────────────────────────────────────────────┘     │
│                          ↑ subject_id                             │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │  Intension Atom（视图内涵 — 语义态）                       │     │
│  │  predicate :: value                                       │     │
│  │  • label / summary / description / type / tags          │     │
│  │  • substance :: <substance-id>     ← 引用物质库            │     │
│  │  • contains / refs / routes-to (关系类，附带 Line)        │     │
│  │  • 自定义 predicate                                        │     │
│  └─────────────────────────────────────────────────────────┘     │
│                          ↑ subject_id                             │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │  Presentation Atom（视图属性 — 视觉态）                    │     │
│  │  layout_id + attribute :: value                           │     │
│  │  • position.x / position.y / pinned                      │     │
│  │  • fill.* / border.* / text.* / size.* / shape          │     │
│  │  • visible / opacity                                      │     │
│  │  • 自定义 attribute                                        │     │
│  └─────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│            声明式资源（代码 / JSON，加载时注册）                      │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │  Substance Library（物质库 — 物理态）                      │     │
│  │  id : Substance                                           │     │
│  │  • visual    （视觉投射：默认形状 / 颜色 / 文字）            │     │
│  │  • physical  （物理属性：density / hardness / mass / ...）│     │
│  │  • chemical  （领域属性：formula / crystal_system / ...）│     │
│  │  • behavior  （交互提示：clickable / expandable / ...）   │     │
│  │  几何体通过 intension atom `substance :: id` 引用         │     │
│  └─────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                      运行时（不持久化）                             │
│  • 布局引擎产物：computed positions                                │
│  • 渲染合成：默认 ⊕ substance.visual ⊕ presentation atoms        │
│  • 派生数据：Surface 凸包 / Line 弯曲路径 / 节点 label 自适应字号    │
└──────────────────────────────────────────────────────────────────┘
```

### 1.7 完整示例：`Application` 节点的四态

```
─── 数学态 ───
graph_geometry:
  { id: 'g-app', graph_id: G1, kind: 'point', members: [], created_at: ... }

─── 物理态（引用 Substance Library 的 'krig-layer'）───
substanceLibrary.get('krig-layer'):
  {
    id: 'krig-layer',
    visual: {
      shape: 'hexagon',
      fill: { color: '#1a1a1a' },
      border: { color: '#666', width: 3 },
      text: { color: '#fff', size: 18 },
      size: { width: 80, height: 80 },
    },
  }

─── 语义态 ───
graph_intension_atom (5 条):
  { subject: g-app, predicate: 'substance',     value: 'krig-layer',                  value_kind: 'ref' }
  { subject: g-app, predicate: 'label',         value: 'Application',                value_kind: 'text' }
  { subject: g-app, predicate: 'type',          value: 'layer',                       value_kind: 'text' }
  { subject: g-app, predicate: 'summary',       value: '桌面应用本身。',               value_kind: 'text' }
  { subject: g-app, predicate: 'implementation',value: 'src/main.ts',                value_kind: 'code' }
  { subject: g-app, predicate: 'contains',      value: 'g-window',                    value_kind: 'ref' }

─── 视觉态 ───
graph_presentation_atom (3 条 — 在 force 布局下被拖动后):
  { layout: 'force', subject: g-app, attribute: 'position.x', value: '120',  value_kind: 'number' }
  { layout: 'force', subject: g-app, attribute: 'position.y', value: '80',   value_kind: 'number' }
  { layout: 'force', subject: g-app, attribute: 'pinned',     value: 'true', value_kind: 'boolean' }

─── 渲染合成 ───
最终视觉:
  shape  = 'hexagon'                  ← 来自 substance.visual
  fill   = '#1a1a1a'                  ← 来自 substance.visual（presentation 没覆盖）
  border = { '#666', 3 }              ← 来自 substance.visual
  text   = '#fff', 18px               ← 来自 substance.visual
  size   = 80×80                      ← 来自 substance.visual
  position = (120, 80)                ← 来自 presentation
  pinned = true                       ← 来自 presentation
  label  = 'Application'              ← 来自 intension
```

`Application` 同时是数学态（六边形几何）+ 物理态（krig-layer 物质）+ 语义态（含 5 条描述）+ 视觉态（含位置 + pin）。

---

## 2. 布局引擎

### 2.1 设计原则

- 位置是纯函数的产物：`layout(geometries, intensions, presentations) → positions`
- 不持久化算法输出
- 算法可插拔（注册表）
- pin 优先：算法尊重 `pinned` 几何体，其他围绕重排
- 物理属性预留：v3.0 后算法可读 `substance.physical.mass / charge` 驱动力导

### 2.2 `LayoutAlgorithm` 接口

```typescript
interface LayoutAlgorithm {
  id: string;
  label: string;
  supportsDimension: (2 | 3)[];
  compute(input: LayoutInput): LayoutOutput;
}

interface LayoutInput {
  geometries: GraphGeometryRecord[];      // 全部几何体
  intensions: GraphIntensionAtom[];       // 用于算法启发
  presentations: GraphPresentationAtom[]; // 读 pinned 和已记录的位置
  substanceResolver: (id: string) => Substance | undefined;  // v3 用
  dimension: 2 | 3;
  bounds?: { width: number; height: number; depth?: number };
}

interface LayoutOutput {
  positions: Map<string, { x: number; y: number; z?: number }>;
}
```

### 2.3 v1 内置算法

| id | 实现库 | 适用维度 | v1 状态 |
|---|---|---|---|
| `force` | d3-force | 2D（默认） | **v1 实现** |
| `grid` | 自实现 | 2D | **v1 实现**（fallback） |
| `manual` | 纯 presentation 驱动 | 2D / 3D | **v1 实现** |
| `tree` | d3-hierarchy | 2D | v1.5 |
| `radial` | d3-hierarchy radial | 2D | v1.5 |
| `circle` | 自实现 | 2D | v1.5 |
| `force-3d` | d3-force-3d | 3D | v2.0 |

### 2.4 算法对几何体的处理

| Geometry | 算法行为 |
|---|---|
| Point | 参与算法 |
| Line | 不直接参与；位置由 members 的 Points 决定 |
| Surface | 不直接参与；位置由 members 的 Points 凸包决定 |
| Volume | 不直接参与；位置由 members 的 Surfaces 边界决定 |

### 2.5 active_layout 切换

GraphToolbar dropdown：`Layout: Force ▾`

切换流程：
1. UPDATE `graph.active_layout`
2. 清空运行时 positions
3. 调用对应算法重算
4. 渲染层 fade-in（CSS transition 0.3s）

---

## 3. Markdown 导入语法

### 3.1 节点（Point）定义

```markdown
# 标题文本 [[node-id]]

> 一句话摘要（隐式 summary）

- substance :: krig-layer
- type :: layer
- predicate1 :: value1
- contains :: [[other-id]]
- refs :: [[another-id]]

后续段落是节点的 description。
```

### 3.2 Surface 定义

```markdown
# 集群标题 [[cluster-id]] {kind: surface}

> 一句话摘要

- substance :: krig-grouping
- boundary :: [[member-1]]
- boundary :: [[member-2]]
- boundary :: [[member-3]]
```

`{kind: surface}` 标记几何类型；`boundary` 关系列出 vertices；`substance` 引用物质。
**默认 `kind: point`**（不写 `{kind: ...}` 时）。

### 3.3 Line 不需要显式定义

Line 由关系类 predicate 自动生成；可通过 substance 注册的 Line 类物质指定视觉。

### 3.4 Volume 占位（v1 不渲染）

```markdown
# 子系统标题 [[subsystem-id]] {kind: volume}

- substance :: krig-module
- boundary :: [[surface-1]]
- boundary :: [[surface-2]]
```

### 3.5 节点 id 规则

- `[[]]` 内必须 kebab-case：`[a-z0-9][a-z0-9-]*`
- 同图谱内唯一
- 可在出现前引用（解析器两遍扫描）

### 3.6 frontmatter

```yaml
---
title: KRIG Note 核心概念        # 图谱标题
graph_variant: knowledge          # variant id
dimension: 2                      # 维度（默认 2，v1 仅支持 2）
folder_id: null                   # 目标文件夹
active_layout: force              # 默认布局
---
```

### 3.7 多值

```markdown
- tags :: 架构
- tags :: 核心
```

→ 多条 intension atom，`sort_order` 按出现顺序。

### 3.8 边的额外属性（v2 占位语法，v1 不实现）

```markdown
- contains :: [[other-id]] {strength: 1.0}
```

`{...}` 内的 key:value 挂到生成的 Line 几何体上。v1 解析器忽略 `{...}` 部分。

---

## 4. 解析器

### 4.1 输入输出

```typescript
function parseMarkdown(content: string): ParseResult;

interface ParseResult {
  meta: {
    title?: string;
    graph_variant?: string;
    dimension?: 2 | 3;
    folder_id?: string | null;
    active_layout?: string;
  };
  geometries: ParsedGeometry[];
  intensions: ParsedIntensionAtom[];
  warnings: string[];
}

interface ParsedGeometry {
  id: string;                            // 解析时分配的临时 id
  kind: GeometryKind;
  members: string[];
}

interface ParsedIntensionAtom {
  subject_id: string;
  predicate: string;
  value: string;
  value_kind: IntensionValueKind;
  sort_order: number;
}
```

**注意**：解析器**不输出 presentation atom**——位置由布局引擎实时计算，颜色等 v1 不导入。

### 4.2 实现位置

`src/plugins/graph/main/import/parser.ts`

### 4.3 算法

```
Pass 1: 收集所有 # heading 的 [[id]] 和 kind → idRegistry
Pass 2: 逐节点解析
  for each # heading:
    创建一个几何体 (id, kind=point/surface/volume)
    for each line in this section:
      - > 文字  → intension atom (predicate=summary)
      - - key :: value:
          • intension atom (predicate=key, value)
          • 若 key 在关系类白名单 + value 是 [[id]]:
              额外创建 Line 几何体（kind=line, members=[this, value]）
              额外加 Line 的 type intension
          • 若 key === 'boundary' + 当前 kind=surface/volume:
              加到当前几何体的 members 列表
      - 普通段落 → 累加到 description intension
                   → 行内 [[id]] 同时作为隐式 refs（生成 Line）
Pass 3: 验证所有 [[id]] 引用存在，否则进 warnings
Pass 4: value_kind 推断（注册表驱动）
```

### 4.4 注册表（关系类 / value_kind）

`src/plugins/graph/main/import/registries.ts`：

```typescript
// 关系类 predicate（v1 内置 6 + boundary）
relationPredicateRegistry.register({ predicate: 'contains',   generateGeometry: 'line' });
relationPredicateRegistry.register({ predicate: 'refs',       generateGeometry: 'line' });
relationPredicateRegistry.register({ predicate: 'references', generateGeometry: 'line' });
relationPredicateRegistry.register({ predicate: 'routes-to',  generateGeometry: 'line' });
relationPredicateRegistry.register({ predicate: 'defines',    generateGeometry: 'line' });
relationPredicateRegistry.register({ predicate: 'links-to',   generateGeometry: 'line' });
relationPredicateRegistry.register({ predicate: 'links_to',   generateGeometry: 'line' });
relationPredicateRegistry.register({ predicate: 'boundary',   addToMembers: true });

// value_kind 推断器（顺序匹配）
valueKindRegistry.register({ test: (s) => /^\[\[[a-z0-9-]+\]\]$/.test(s), kind: 'ref' });
valueKindRegistry.register({ test: (s) => /^https?:\/\//.test(s),         kind: 'url' });
valueKindRegistry.register({ test: (s) => /^-?\d+(\.\d+)?$/.test(s),      kind: 'number' });
valueKindRegistry.register({ test: (s) => /^`.*`$/.test(s),               kind: 'code' });
// 默认 text
```

---

## 5. UI 阶段化交付

### 5.1 v1（本 milestone）— 数据齐全 + 最简 UI

**入口**：NavSide ActionBar 加 `+ 导入` 按钮

**流程**：
1. 点 `+ 导入` → 文件对话框（`.md` 过滤器）
2. 选文件 → 主进程读 → 解析 → 写入 → 切到新建图谱
3. 加载图谱：读全部数据 → resolveSubstance → 调布局算法 → 渲染

**几何体呈现**：
- Point：圆 / 物质指定的形状（v1.3 已有，迁移到新模型）
- Line：曲线 / 物质指定的样式
- Surface：半透明凸包多边形（**新增**）
- Volume：v1 不渲染（数据库有，画布看不到）

**节点显示**：图上显示 `label` intension atom；外观由 substance + presentation 合成

**布局切换**：GraphToolbar dropdown（Force / Grid / Manual）

**反馈**：Toast：「导入成功：N 个几何体，K 条属性，M 个物质引用」

### 5.2 v1.5+ 后续（不在本 spec）

- Hover tooltip 显示 summary
- IntensionPanel（条目式增删改 intension atom）
- PresentationPanel（视觉属性面板）
- SubstancePanel（物质库浏览 / 用户自定义物质 UI）
- 更多布局算法（tree / radial / circle / sugiyama）
- 主题系统（substance 集合切换）
- 物理属性驱动力导（substance.physical.mass → 节点惯性）

---

## 6. 数据流（端到端）

### 6.1 导入流

```
用户点 + 导入
   ↓
NavSide → window.dispatchEvent('navside:action', { actionId: 'import-md' })
   ↓
GraphPanel 监听 → ops.handleImport()
   ↓
navSideAPI.graphImportFromFile() → 主进程
   ├─ dialog.showOpenDialog → filePath
   ├─ fs.readFile → content
   ├─ parser.parseMarkdown(content) → ParseResult
   └─ importer.import(parseResult)
        ├─ graphStore.create(meta.title, dimension, active_layout, ...)
        ├─ graphGeometryStore.createBulk(geometries)
        └─ graphIntensionAtomStore.createBulk(intensions)
   ↓
广播 GRAPH_LIST_CHANGED
   ↓
graphSetActive(newGraphId)
```

### 6.2 加载流

```
GraphView 收到 graphSetActive
   ↓
viewAPI.graphLoad(graphId)
   ↓ 主进程
   ├─ graphStore.get(graphId) → graph 元数据 + active_layout
   ├─ graphGeometryStore.list(graphId) → geometries
   ├─ graphIntensionAtomStore.list(graphId) → intensions
   └─ graphPresentationAtomStore.list(graphId, layout='*' OR active_layout) → presentations
   ↓
GraphView 接收完整数据
   ├─ resolveSubstance(intension) → 每个引用 substance 的几何体获得 substance 数据
   ├─ layoutEngine.compute({ geometries, intensions, presentations, dimension }) → positions
   ├─ render = 默认 ⊕ substance.visual ⊕ presentation overrides ⊕ position
   └─ renderer.render(...)
```

### 6.3 拖动流（写 presentation atom）

```
用户拖 Point geometry-A 到 (100, 200) in 'force' layout
   ↓
viewAPI.graphSetPresentationBulk(graphId, [
  { layout: 'force', subject: A, attribute: 'position.x', value: '100', value_kind: 'number' },
  { layout: 'force', subject: A, attribute: 'position.y', value: '200', value_kind: 'number' },
  { layout: 'force', subject: A, attribute: 'pinned',     value: 'true', value_kind: 'boolean' },
])
   ↓ 主进程 upsert
   ↓
广播 GRAPH_PRESENTATION_CHANGED
```

---

## 7. IPC / API 增量

### 7.1 新增 IPC 常量（`src/shared/types.ts`）

```typescript
// 导入
GRAPH_IMPORT_FROM_FILE: 'graph:import-from-file',

// 图加载
GRAPH_LOAD: 'graph:load',                         // 返回 { graph, geometries, intensions, presentations }

// Geometry
GRAPH_GEOMETRY_CREATE: 'graph:geometry-create',
GRAPH_GEOMETRY_DELETE: 'graph:geometry-delete',

// Intension Atom
GRAPH_INTENSION_LIST: 'graph:intension-list',
GRAPH_INTENSION_CREATE: 'graph:intension-create',
GRAPH_INTENSION_UPDATE: 'graph:intension-update',
GRAPH_INTENSION_DELETE: 'graph:intension-delete',
GRAPH_INTENSION_CREATE_BULK: 'graph:intension-create-bulk',

// Presentation Atom
GRAPH_PRESENTATION_LIST: 'graph:presentation-list',
GRAPH_PRESENTATION_SET: 'graph:presentation-set',
GRAPH_PRESENTATION_DELETE: 'graph:presentation-delete',
GRAPH_PRESENTATION_SET_BULK: 'graph:presentation-set-bulk',
GRAPH_PRESENTATION_CHANGED: 'graph:presentation-changed',  // 广播

// Substance（v1 仅查询，写入留 v2）
GRAPH_SUBSTANCE_LIST: 'graph:substance-list',
GRAPH_SUBSTANCE_GET: 'graph:substance-get',

// Layout
GRAPH_SET_ACTIVE_LAYOUT: 'graph:set-active-layout',
```

### 7.2 新增 stores

`src/main/storage/graph-geometry-store.ts`、`graph-intension-atom-store.ts`、`graph-presentation-atom-store.ts`：见原 spec 7.2 描述。

### 7.3 新增 Substance Library

`src/plugins/graph/renderer/substance/`（新目录）：
- `types.ts` — `Substance` 接口
- `registry.ts` — `SubstanceLibrary` 类
- `built-in/krig-software-domain.ts` — KRIG 自身领域物质（10 个）
- `built-in/relations.ts` — 关系类 Line 物质（5 个）
- `index.ts` — 默认导出 + 自动注册内置

### 7.4 删除 / 重命名

- 删除：`graph-node-store.ts`、`graph-edge-store.ts`
- 重命名：`graphview-store.ts` → `graph-store.ts`

### 7.5 新增导入器

`src/plugins/graph/main/import/`（新目录）：
- `parser.ts` — MD → ParseResult
- `handler.ts` — 调度 stores 写入
- `registries.ts` — 关系类 / value_kind 注册表

### 7.6 新增布局引擎

`src/plugins/graph/renderer/layout/`（新目录）：见原 spec 7.5 描述。

---

## 8. 文件清单

**新增（substance / library 相关）**：
- `src/plugins/graph/renderer/substance/types.ts`
- `src/plugins/graph/renderer/substance/registry.ts`
- `src/plugins/graph/renderer/substance/built-in/krig-software-domain.ts`
- `src/plugins/graph/renderer/substance/built-in/relations.ts`
- `src/plugins/graph/renderer/substance/index.ts`

**新增（数据层 / 解析 / 布局）**：
- `src/main/storage/graph-store.ts`（重命名自 graphview-store.ts）
- `src/main/storage/graph-geometry-store.ts`
- `src/main/storage/graph-intension-atom-store.ts`
- `src/main/storage/graph-presentation-atom-store.ts`
- `src/plugins/graph/main/import/parser.ts`
- `src/plugins/graph/main/import/handler.ts`
- `src/plugins/graph/main/import/registries.ts`
- `src/plugins/graph/renderer/layout/types.ts`
- `src/plugins/graph/renderer/layout/force.ts`
- `src/plugins/graph/renderer/layout/grid.ts`
- `src/plugins/graph/renderer/layout/manual.ts`
- `src/plugins/graph/renderer/layout/registry.ts`
- `src/plugins/graph/renderer/layout/index.ts`
- `docs/graph/samples/KRIG-Note-Concept.md`（升级到新语法）

**修改**：
- `src/main/storage/schema.ts` — 加 `graph_geometry` / `graph_intension_atom` / `graph_presentation_atom`；删 `graph_node` / `graph_edge`
- `src/main/storage/types.ts` — 新类型定义
- `src/shared/types.ts` — 加 IPC 常量
- `src/main/preload/navside.ts` — 加 `graphImportFromFile`
- `src/main/preload/view.ts` — 加 `graphLoad` / `graphSetPresentationBulk` / `graphSetActiveLayout` / `graphSubstanceList` 等
- `src/plugins/graph/main/ipc-handlers.ts` — 注册新 handler
- `src/plugins/graph/main/register.ts` — ActionBar 加 `+ 导入` button
- `src/plugins/graph/navside/useGraphOperations.ts` — 接 `import-md` action
- `src/plugins/graph/components/GraphView.tsx` — 接入新加载流程 + 布局引擎 + substance 合成
- `src/plugins/graph/components/GraphToolbar.tsx` — 加 layout dropdown
- `src/plugins/graph/renderer/NodeRenderer.ts` — 适配新数据形态 + substance.visual 默认
- `src/plugins/graph/renderer/EdgeRenderer.ts` — 适配新数据形态 + substance.visual 默认
- 新增 `src/plugins/graph/renderer/SurfaceRenderer.ts` — 半透明凸包多边形

**删除**：
- 老的 `graph_node` / `graph_edge` 表数据（启动时 `DELETE graph; DELETE graph_node; DELETE graph_edge;`，无 UI）

---

## 9. 测试用例

### 9.1 单元（解析器）

- [ ] 空文件 → 0 几何体 0 atom
- [ ] 单 Point 无属性 → 1 几何体 (kind=point) 0 intension
- [ ] Point + 多 intension → 1 几何体 N intension
- [ ] `substance :: krig-layer` → 1 条 substance intension
- [ ] `contains :: [[id]]` → 1 个 Line 几何体 + 1 条 contains intension + 1 条 Line type intension
- [ ] `# X [[x]] {kind: surface}` + boundary → 1 个 Surface 几何体（members 含 boundary 项）
- [ ] 同 predicate 多次 → N 条 intension 按 sort_order
- [ ] 引用不存在的 id → warning，不建几何体
- [ ] 行内 `[[id]]` → 隐式 refs Line + intension
- [ ] value 类型推断（ref / url / number / code / text）

### 9.2 单元（substance library）

- [ ] register / get / list 基本 API
- [ ] applies_to_kinds 过滤生效
- [ ] 内置 KRIG 物质包加载完整（10+5 个）
- [ ] 不存在 substance id → resolver 返回 undefined（渲染层兜底默认）

### 9.3 单元（渲染合成）

- [ ] 无 substance + 无 presentation → 渲染用系统默认
- [ ] 有 substance + 无 presentation → 渲染用 substance.visual
- [ ] 有 substance + 有 presentation 局部覆盖 → 渲染合并（presentation 优先）
- [ ] substance 引用不存在 → 兜底默认 + console.warn

### 9.4 单元（布局引擎）

- [ ] force：Point 散开，Line/Surface 跟随，无重叠
- [ ] grid：Point 严格方阵
- [ ] manual：有 presentation `position.*` 的按值，无的 (0,0)
- [ ] pinned=true 在 force 下：被钉 Point 不动

### 9.5 端到端

- [ ] 导入 KRIG-Note-Concept.md → 20+ Points + 3 Surfaces + 30+ Lines
- [ ] 节点视觉按 substance 自动统一（所有 layer 都是六边形）
- [ ] 切换 layout（force ↔ grid ↔ manual）→ 位置重算
- [ ] 拖动 Point → 自动写 pinned + position，刷新后保留
- [ ] Reset Layout → 当前 layout 的 position/pinned atoms 清空
- [ ] 删除 graph → geometry + intension + presentation 级联清空
- [ ] 退出 app → 重启 → 数据完整

### 9.6 边界

- [ ] 导入 5MB MD → 不卡死
- [ ] 同名 id 重复 → warning + 跳过
- [ ] Line 引用不存在 Point → warning + 不建 Line
- [ ] Surface members 少于 3 → warning + 不建 Surface
- [ ] 100+ Points 的图 → force < 1 秒收敛
- [ ] 引用不存在的 substance id → 兜底默认 + 仍能渲染

---

## 10. 工作量估算

| 阶段 | 内容 | 时间 |
|---|---|---|
| 数据层重构 | schema + 3 个 stores + 类型定义 + 删旧表 | 1.5 天 |
| Substance Library | 注册表 + 接口 + 15 个内置物质 | 1 天 |
| 解析器 | parser + 注册表 + 单元测试 | 1.5 天 |
| 布局引擎 | force / grid / manual + 注册表 + 单元测试 | 1.5 天 |
| 渲染层接入 | GraphView 改造 + Surface 凸包渲染器 + substance 合成 | 2 天 |
| 主进程胶水 | import-handler + IPC + preload | 1 天 |
| GraphToolbar | layout dropdown + 重置按钮 | 0.5 天 |
| 插件层 | NavSide ActionBar + ops + 文件对话框 | 0.5 天 |
| 端到端测试 + 修 bug | — | 1 天 |
| **合计** | — | **10.5 天** |

比"无 substance"模型多 1.5 天（Substance Library + 渲染合成逻辑），但**架构正确性 100%**，未来 Domain Knowledge 包 / 主题 / 物理仿真 / 推理引擎等扩展都不需要改 schema。

---

## 11. 决策点（开工前确认）

| # | 问题 | 默认 |
|---|---|---|
| 1 | 关系类 predicate 白名单 | `contains` / `refs` / `references` / `routes-to` / `defines` / `links-to` / `links_to` / `boundary` |
| 2 | `label` / `summary` / `description` / `type` / `substance` 是否保留词 | 是 |
| 3 | 节点 id 必须 kebab-case | 是 |
| 4 | v1 默认 layout | `force` |
| 5 | v1 实现哪几种 layout | `force` / `grid` / `manual` |
| 6 | 拖动几何体是否自动 pin | 是 |
| 7 | v1 是否渲染 Surface | 是（半透明凸包多边形） |
| 8 | v1 是否渲染 Volume | 否（数据模型支持，渲染留 v2.0） |
| 9 | v1 是否实现 Substance Library | **是**（这是本 spec 的核心新增） |
| 10 | v1 内置物质数量 | 10 个 KRIG 软件领域 + 5 个关系类 |
| 11 | v1 是否实现自定义 Substance UI | 否（留 v2.x） |
| 12 | substance 物理 / 化学字段 v1 是否读取 | 否（数据结构留出，v3 用） |
| 13 | 旧数据清理 | 启动时一次性 SQL DELETE，无 UI |
| 14 | 表 / 字段命名语言 | 英文 |
| 15 | 维度 | v1 仅 `dimension: 2`，3D 留 v2.0 |

---

## 12. 与现有架构的影响

- **不动 ProseMirror schema**：atom / substance 是 graph 自治概念，不渗透到 NoteView
- **GraphView 渲染层重构**：从"节点 + 边" → "几何体 + substance"，是**这次 milestone 最大的 UI 改动点**
- **NavSide 微调**：ActionBar 多一个 button + handle 一个 action
- **v1.3 数据丢弃**：用户已确认无负担

---

## 13. 后续扩展路线

| 阶段 | 内容 |
|---|---|
| **v1.0（本 spec）** | 四态分立架构 + MD 导入 + force/grid/manual 布局 + 基础 Substance Library |
| v1.1 | Hover tooltip 显示 summary |
| v1.2 | 几何体 type 视觉区分（按 type intension 上色） |
| v1.5 | IntensionPanel + PresentationPanel UI |
| v1.6 | 更多 layout（tree / radial / circle / sugiyama） |
| v1.7 | 导出（图谱 → MD） |
| v2.0 | **3D 渲染**：dimension=3 + force-3d + Volume 渲染 |
| v2.1 | SubstancePanel + 用户自定义 Substance UI |
| v2.2 | 主题系统（Substance 集合切换 — paper / dark / scientific 等） |
| v2.3 | 第三方 Substance 包（社区贡献领域知识包） |
| v3.0 | **物理属性驱动**：substance.physical.mass → 力导节点权重；substance.physical.charge → 排斥力 |
| v3.1 | 化学属性驱动搜索：「找出所有硬度 > 9 的物质」 |
| v3.5 | **推理引擎**（subClassOf 传递、属性继承、自动建议物质） |
| v4.0 | 用户自定义几何体类型（curve / region / 自定义 kind） |
| v4.1 | RDF / OWL 导出（数据已对齐 OWL，主要是序列化器） |

---

## 14. 参考

- [OWL 2 Web Ontology Language Primer](https://www.w3.org/TR/owl2-primer/)
- [Protégé](https://protege.stanford.edu/) — annotation 交互模式
- [Cytoscape.js Layouts](https://js.cytoscape.org/#layouts)
- [d3-force](https://github.com/d3/d3-force) — v1 force 实现
- [d3-force-3d](https://github.com/vasturiano/d3-force-3d) — v2.0 3D 力导
- [Three.js Material](https://threejs.org/docs/#api/en/materials/Material) — Substance 概念部分对应
- [Obsidian Dataview](https://blacksmithgu.github.io/obsidian-dataview/) — `key :: value` 语法来源
- KRIG-Note Concept Sample: [`samples/KRIG-Note-Concept.md`](samples/KRIG-Note-Concept.md)

---

## 15. 核心架构洞察

1. **四态分立** — 数学态（Geometry）/ 物理态（Substance）/ 语义态（Intension）/ 视觉态（Presentation）正交独立，分别持久化、独立演化
2. **几何 = 数学态** — Point / Line / Surface / Volume 是抽象数学结构，与现实无关；它们是图谱的几何骨架
3. **物质 = 物理态** — Substance 是客观世界的实体投射，承载完整领域知识（视觉 / 物理 / 化学 / 行为）
4. **Substance 引用即 Domain Knowledge** — 引用 `diamond` 一次，节点立刻获得钻石的视觉模板 + 物理属性 + 化学知识，未来可驱动推理
5. **几何体一等公民** — 不是"节点 + 边"特例，是统一抽象，未来可加 curve / region 等
6. **图非画布** — 位置是渲染态，由布局算法实时算出，只有 pinned 才持久化
7. **持久化最小化** — 只存"用户表达的意图" + "无法重新计算的事实"
8. **关系的双重身份** — `contains :: [[x]]` 既是 intension atom 又是 Line 几何体
9. **属性可增减不动 schema** — atom 单表 + 自由 predicate / attribute
10. **layout_id 命名空间** — Presentation atom 按 layout 分组，`'*'` 表跨布局通用
11. **维度由图谱定** — `graph.dimension`，几何体不携带维度
12. **不存就不会错** — 不存的字段不会因算法升级而过时
13. **OWL 对齐** — geometry ≈ Class/Individual/ObjectProperty，intension ≈ Annotation/DataProperty，substance ≈ 领域 ontology pack
14. **渲染合成顺序** — 默认 ⊕ substance.visual ⊕ presentation atoms ⊕ 运行时位置（后者覆盖前者）
15. **Substance Library 三个层级** — built-in（KRIG 内置）/ themes（主题包）/ user（用户自定义）；未来支持第三方贡献
