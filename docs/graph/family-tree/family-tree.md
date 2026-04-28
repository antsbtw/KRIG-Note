# Family Tree — Graph view 的族谱 variant

KRIG 的 Graph view 的 **family-tree variant**,把含人物关系的 note 渲染为族谱图。

## 0. 架构定位

### 0.1 KRIG view 体系

KRIG 有几个**顶层 view**,平级关系:

```
KRIG views (顶层视图):
├── NoteView   (笔记)
│     └── variant: thought (思考流模式)
├── EBookView  (电子书)
├── WebView    (网页)
└── Graph      (图谱)  ← 本文档涉及
      ├── variant: family-tree    (族谱 — 本 spec 范围)
      ├── variant: knowledge      (知识图谱,后续)
      ├── variant: mindmap        (思维导图,后续)
      ├── variant: timeline       (时间轴,后续)
      └── ...
```

**Graph 是 KRIG 顶层 view,平级于 NoteView**。
**family-tree 是 Graph 的 variant**(类比 thought 是 NoteView 的 variant)。

### 0.2 KRIG 三层架构

```
┌──────────────────────────────────────────────────────────┐
│ 语义层 (Semantic Layer) — 真理之源,知识本身              │
│   note —— 一份完整知识单元(富文本 + 结构化关系 + 推理)   │
│   note 之间用衍生关系(derived_from)表达派生(类似 git)    │
├──────────────────────────────────────────────────────────┤
│ 表征层 (Presentation Layer) — view 自己的渲染数据        │
├──────────────────────────────────────────────────────────┤
│ View 层 (Render Layer)                                   │
│   NoteView / Graph / EBookView / WebView / ...           │
│   每个 view 内部可有多个 variant                         │
└──────────────────────────────────────────────────────────┘
```

### 0.3 v1 范围

**Graph 顶层 view 在 v1 范围内只做 family-tree variant**:
- 接收一篇族谱 note 作为输入
- 解析 note 内容里的人物 + 关系
- 用专业族谱视觉(GenoPro / GRAMPS 共识)渲染为图

**不做**(v1 范围之外):
- 不新建 SurrealDB schema(用现有 note 存储)
- 不接通 NoteView block 的"自动语义抽取"(v1 用户在 note 里**显式写**关系)
- 不实现 Graph 其他 variant(knowledge / mindmap / timeline 等留 v1.5+)
- 不实现 GEDCOM 互通 / 祖先视图 / 沙漏视图等高级功能

### 0.4 与现有 KRIG 模块的关系

- **note 存储**:复用现有 `note-store`(无改动)
- **note 衍生关系**:复用现有 SurrealDB RELATE 机制(`sourced_from` / `links_to` / 必要时新增 `derived_from`)
- **NavSide**:在 Graph 目录下创建族谱 note 的入口
- **markdown 导入**:复用现有 markdown 导入,frontmatter 标识 `view: graph` + `variant: family-tree`

### 0.5 family-tree 与 BasicView 的关系

family-tree variant **不直接用 Three.js**。它通过 **BasicView 共享底座**(详见 [docs/graph/basic/BasicView.md](../basic/BasicView.md))拿到:
- **Shape**(rounded-rect / line / arrow / 等)
- **Substance 注册**(family/person 等语义模板)
- **Label 系统**(SVG 文字渲染)
- **交互**(pan / zoom / click / drag)

family-tree 自己实现的:
- markdown parser(从 note 内容抽取人物 + 关系)
- layout 算法(Walker tidy tree)
- 视觉规则(嫡庶 / 已故 / 占位等族谱专属规则,通过 BasicView 注册中心查 shape + substance)
- 特殊几何(drop+sibling-bar+stub 父子边)

**family-tree 是 BasicView v1 的第一个消费者** — 它的需求驱动 BasicView 注册接口的暴露,同时验证 BasicView 接口是否好用。

## 1. 设计原则

1. **数据通用,视图专属** — 数据用 KRIG 通用 note,渲染用 family-tree 专属
2. **算法读结构,视觉读属性** — 布局算法只看节点关系,视觉规则只看属性 → 视觉的属性映射
3. **还原历史真实** — 嫡庶 / 已故 / 占位等历史信息忠实呈现,不抹平文化差异
4. **对标专业工具**(GenoPro / GRAMPS / MyHeritage / Family Tree Maker)— 不自创视觉规则
5. **属性名对齐工业标准**(schema.org / GEDCOM)— 不自创字段名
6. **note 是真理之源,view 只读** — view 永远不改写 note 内容
7. **数据驱动布局** — 用户怎么填,视觉就怎么呈现

## 2. 数据契约(note 的内容格式)

### 2.1 一篇族谱 note 的总体结构

```markdown
---
title: 红楼梦人物族谱
view: family-tree
---

(可选:序言、说明文字...)

# 贾政 [[jia-zheng]]

- gender :: M
- birth :: 1700

# 王夫人 [[wang-furen]]

- gender :: F

# (其他人物 ...)

## 关系

- [[jia-zheng]] spouse [[wang-furen]] {marriage_order: 1, rank: principal}
- [[jia-zheng]] spouse [[zhao-yiniang]] {rank: secondary, concurrent_with: [[jia-zheng-wang]]}
- [[jia-zheng]] parent [[jia-baoyu]] {pedigree: birth}
- [[zhao-yiniang]] parent [[jia-huan]] {pedigree: birth}
```

### 2.2 frontmatter

```yaml
---
title: 显示名
view: family-tree            # 必填:标识此 note 用 family-tree 渲染
---
```

`view: family-tree` 必填。view 注册表通过这个字段决定用哪个 view 组件渲染。

### 2.3 人物(Node)

每个一级标题(`# 姓名 [[id]]`)是一个人物节点:
- `# 姓名` — 显示名(label)
- `[[id]]` — 唯一身份(本 note 内唯一)

人物属性写在标题下的列表里,语法 `- key :: value`:

| 属性 | 取值 | 说明 | 视觉影响 |
|---|---|---|---|
| `gender` | `M` / `F` / `O` / `U` | 性别(对齐 schema.org Person.gender) | 节点填充色 |
| `birth` | `YYYY` 或 `YYYY-MM-DD` | 出生(对齐 schema.org birthDate) | 节点第二行 b. YYYY |
| `death` | `YYYY` 或 `YYYY-MM-DD` | 死亡(对齐 schema.org deathDate) | 节点第二行 d. YYYY + 左上角斜线 + 颜色降饱和度 |
| `legitimate` | `true` / `false` | 嫡 / 庶(默认 true) | 庶子用 140×50 + 虚线边框(默认嫡子 160×60 实线) |
| `placeholder` | `true` | 占位人物(身份已知但具体信息全无) | 虚线框 + `?` 文字 |

### 2.4 关系(Edge)

写在 `## 关系` 段落下,每条关系一行:

```
- [[源]] type [[目标]] {属性...}
```

#### 关系类型(type,对齐 schema.org)

| type | 来源 | 渲染 |
|---|---|---|
| `parent` | schema.org Person.parent | 渲染为 parent 边(drop+sibling-bar+stub) |
| `spouse` | schema.org Person.spouse | 渲染为配偶横线 |
| `sibling` | schema.org Person.sibling | 可选,可由共同 parent 推导(v1 略) |

#### 关系属性(写在 `{...}` 内,key:value 用逗号分隔)

| 属性 | 适用 type | 取值 | 来源 | 视觉影响 |
|---|---|---|---|---|
| `pedigree` | parent | `birth` / `adopted` / `foster` / `step` / `unknown` | GEDCOM 7 PEDI | 实线 vs 虚线 stub |
| `marriage_order` | spouse | `1` / `2` / `3` ... | Wikidata seriesOrdinal | 多婚姻视觉左右排序 |
| `rank` | spouse | `principal` / `secondary` / `unknown` | KRIG 扩展 | 主妻 1.5px 婚姻线 + 标准节点;妾 1px + 略小 |
| `marriage_status` | spouse | `married` / `civil_union` / `unmarried` / `divorced` / `separated` / `unknown` | schema.org / Wikidata | 实线 / 虚线 / 斜线标记 |
| `concurrent_with` | spouse | 其他配偶边的 source/target id 引用 | KRIG 扩展 | 区分"再婚"vs"同时多妻" |

#### 多个配偶的两种语义

**A. 顺序多次婚姻**(serial):多个 spouse 边互不 concurrent_with,按 marriage_order 排序 — 离婚再娶 / 丧偶再娶
**B. 同时多妻 / 多夫**(concurrent):多个 spouse 边互链 concurrent_with — 中国古代正妻 + 妾,伊斯兰一夫多妻

数据上两者用 `concurrent_with` 区分,视觉上由 §3 节点视觉自动呈现差异。

### 2.5 衍生关系(note 之间)

一篇族谱 note 可以**衍生自**另一篇 note(比如《红楼梦》原文):

```yaml
---
title: 红楼梦人物族谱
view: family-tree
derived_from: [[note-honglou-text]]   # 可选,声明这篇 note 是从某 note 衍生而来
---
```

衍生关系用 SurrealDB RELATE 实现,语义上等同 git commit 的 parent。

v1 渲染时**不消费** derived_from(只是元数据);未来可加"查看源 note"链接、版本对比等功能。

## 3. 视觉规范

照搬 GenoPro / GRAMPS 共识。**全部规则都是"属性 → 视觉"映射,无算法分支**。

### 3.1 节点视觉(Person)

属性查表(简单 if):

| 属性 | 默认 | 视觉效果 |
|---|---|---|
| `gender=M` | — | 填充浅蓝 `#a8c7e8` |
| `gender=F` | — | 填充浅粉 `#e8a8c0` |
| `gender=O` | — | 填充浅灰 `#c0c0c0` |
| `gender=U` 或缺失 | ✓ | 填充深灰 `#888` |
| `legitimate=false` | — | 尺寸 140×50(默认 160×60),边框虚线 |
| `placeholder=true` | — | 虚线框 + 文字 `?` 替代姓名 + 不画 b./d. |
| `death` 存在 | — | 左上角对角斜线(`(0,10)→(10,0)`,1px 黑) + 填充饱和度 50% |
| `birth` 存在 | — | 节点第二行显示 `b. YYYY` |
| `death` 存在 | — | 节点第二行显示 `d. YYYY` |
| 都存在 | — | `b. YYYY – d. YYYY` |

**优先级**:`placeholder=true` 视觉优先于 `legitimate=false`(占位是元信息,优先呈现)。

视觉示例(贾政家):
- 王夫人(`gender=F`):浅粉 + 160×60 + 实线
- 赵姨娘(`gender=F`):浅粉 + 160×60 + 实线(在族谱里地位由 spouse 边的 `rank=secondary` 体现,不在节点视觉)
- 贾宝玉(`gender=M`):浅蓝 + 160×60 + 实线
- 贾环(`gender=M`,`legitimate=false`):浅蓝 + 140×50 + 虚线
- 贾代善(`gender=M`,`death=1740`):浅蓝降饱和 + 160×60 + 左上角斜线 + 第二行 `d. 1740`

### 3.2 边视觉

#### parent 边(父子边)

经典族谱外观(GenoPro/GRAMPS/Murdock 共识):drop + sibling bar + stub 三段直角:

```
        父母对中点(婚姻线中点 / 单亲节点正下方)
              |        ← drop line(垂直)
              |
       ┌──────┴──────┐ ← sibling bar(横向跨同父母兄弟)
       |             |
     [child]       [child]   ← stub(短垂直,从 sibling bar 到子节点顶部)
```

**关键**:多个共享同一对父母的子女**共用一条 drop 和 sibling bar**,只有 stub 是各自的。

线宽:1.5px,色 `#666`。

`pedigree` 决定 stub 线型(每条 stub 自己的样式,不影响共享 bar):
- `birth`(默认):实线
- `adopted`:虚线 9-4
- `foster`:点线 2-3
- `step`:虚线 9-4
- `unknown`:虚线 9-4

#### spouse 边(配偶边)

水平横线在两人 y 平均位置(layout 保证两 spouse 同 y)。

| `rank` | 婚姻线粗细 |
|---|---|
| `principal`(默认) | 1.5px |
| `secondary` | 1px |
| `unknown` | 1.5px |

`marriage_status` 决定线型:

| 值 | 视觉 |
|---|---|
| `married` / `civil_union`(默认) | 实线 |
| `unmarried` | 虚线 4-2 |
| `divorced` | 实线 + 中点 `//` 双斜线 |
| `separated` | 实线 + 中点 `/` 单斜线 |
| `unknown` | 实线半透明 50% |

### 3.3 多配偶布局视觉

#### 顺序多次婚姻(serial)

```
[ex-spouse]──[A]──[current-spouse]
   ╲          │            ╱
   ╲     (drop)            ╱
[children of            [children of
 1st marriage]           2nd marriage]
```

- A 居中
- 配偶按 `marriage_order` 升序向同一方向扩展(GenoPro 规则)
- 每个 spouse 独立 drop + sibling bar
- 离异 / 已故配偶用 `marriage_status` / `death` 表达,布局位置同其他配偶

#### 同时多妻 / 多夫(concurrent)

```
            [A 夫]
       ╱      ║      ╲       ╲
   [正妻]══[A]──[妾 1]────[妾 2]
   ┃        ┃        ┃            ┃
 (drop)  (drop)   (drop)       (drop)
   ┃        ┃        ┃            ┃
 [嫡子] [嫡女]   [庶子]         [庶子]
```

- A 居中
- 配偶按 `marriage_order` 升序向同一方向扩展
- **算法不读 spouse_rank**,视觉差异由 §3.1 节点视觉 + §3.2 婚姻线粗细自动呈现
- 看红楼梦:王夫人(rank=principal)+ 赵姨娘(rank=secondary)同代并排 → 视觉自动呈现"嫡庶有别"

#### 混合(serial + concurrent)

例:某人前妻已故 → 续弦正妻 + 同期纳妾。布局算法仅按 `marriage_order` 排序;视觉由各 spouse 边的属性自动呈现差异。

## 4. 布局算法

### 4.1 算法选择

参考 [entitree-flex](https://github.com/codeledge/entitree-flex)(Walker tidy tree + couple-as-side-node)。算法**只读结构**(parent / spouse 边),**不读文化语义**(rank / legitimate / placeholder)。

### 4.2 算法步骤

#### 第 1 步:建索引

```
parents(person)  = 该 person 作为 child(parent 边的 target)所有 source 节点
children(person) = 该 person 作为 source(parent 边的 source)所有 target 节点
spouses(person)  = 与该 person 之间存在 spouse 边的所有节点
```

`parent` 边方向规定 source=parent, target=child(markdown 解析时归一)。

#### 第 2 步:代际分配(generation)

- 主人公(note 第一个人物节点)generation = 0
- BFS 向下:主人公及其配偶的所有 children → generation = 1,递归
- 配偶 generation 同主人公(同代)
- 主人公 BFS 向上(v1 简化:不画祖先,主人公是树根)

#### 第 3 步:同代 x 排布(Walker tidy tree 变种)

1. 按代从底向上算
2. 叶子按 `birth` 升序排,缺失则按 markdown 出现顺序
3. 父代节点 x = `(leftmostChild.x + rightmostChild.x) / 2`
4. 配偶节点排在主人公左右(同 y),按 `marriage_order` 升序
5. 婚姻锚点(虚拟,不渲染)= 两 spouse 中点,作为 drop-line 起点
6. Walker apportion 处理同代不重叠

**算法不读 spouse_rank / legitimate / placeholder**(它们只在视觉层使用)。

#### 第 4 步:y 坐标

- 节点 y = `-generation * layerGap`(KRIG y-up,代数越大 y 越小)
- `layerGap = 120`(默认)

### 4.3 默认参数

| 参数 | 默认 |
|---|---|
| `layout.spacing.sibling` | 30(兄弟之间) |
| `layout.spacing.couple` | 10(配偶之间) |
| `layout.spacing.layer` | 120(代际) |

direction / edge-style 不消费 — 族谱永远"上代在上、下代在下,父子直角折线"。

## 5. 实现架构

### 5.1 模块清单

```
src/plugins/graph/                    # Graph 顶层 view 插件
├── basic/                            # BasicView 共享底座(family-tree v1 一并建立)
│   ├── scene/SceneManager.ts         # Three.js scene + camera + RAF
│   ├── shapes/                       # rect / circle / line / arrow / rounded-rect / hexagon
│   ├── labels/                       # label 6 种位置
│   ├── substance/                    # SubstanceRegistry + 内置 substance(family/person 等)
│   ├── interaction/InteractionController.ts  # pan / zoom / click / drag
│   └── index.ts                      # 导出 shapeRegistry / substanceRegistry / labelRegistry
│
├── variants/
│   └── family-tree/                  # 本 spec 范围
│       ├── parser/
│       │   ├── parse-note.ts         # 解析 note markdown → { nodes, edges }
│       │   └── types.ts
│       ├── layout/
│       │   └── walker-tidy.ts        # Walker tidy tree + couple-as-side-node
│       ├── projection/
│       │   ├── visual-rules.ts       # 属性 → BasicView shape/style 映射
│       │   ├── spouse-line.ts        # 配偶横线生成
│       │   └── parent-edge.ts        # drop+bar+stub 三段折线生成
│       ├── FamilyTreeView.tsx        # React 组件(集成 BasicView 渲染 + family-tree 逻辑)
│       └── register.ts               # 注册为 Graph 的 family-tree variant
│
├── renderer.tsx                      # Graph view 顶层入口(在 webContents 挂载)
└── main/
    └── register.ts                   # 注册 Graph view 到 KRIG view 体系
```

**关键架构原则**:
- `basic/` 提供共享 Three.js 底座 + 注册中心(`shapeRegistry` / `substanceRegistry` / `labelRegistry`)
- `variants/family-tree/` 通过这套接口拿 shape + substance,自己负责数据 schema、layout、视觉规则
- 未来 `variants/knowledge/`、`variants/mindmap/` 加入时,**复用 basic/ 不动 family-tree/**

### 5.2 数据流

```
用户在 NavSide 选 family-tree note
   ↓
Graph view 创建 family-tree variant 实例
   ↓
view 加载 note(noteAPI.load(noteId))
   ↓
variants/family-tree/parser/ 解析 note 内容 → { nodes, edges }
   ↓
variants/family-tree/layout/ Walker tidy → positions Map
   ↓
variants/family-tree/projection/ 属性 → BasicView shape/style 映射
   ↓
basic/ 渲染 Three.js 场景(shape mesh + label + 边几何)
   ↓
用户看到族谱
```

**全程不入库**(除了原 note 本身)。位置不持久化(每次打开重算;v1.5 加"用户拖动后保存位置"再说)。

### 5.3 渲染技术选型

**Three.js + SVG label**(由 BasicView 共享底座提供)。理由:
- 与 KRIG Graph 顶层 view 技术栈统一(BasicView 定义)
- 后续其他 variants(knowledge / mindmap)同样基于 Three.js,共享底座
- 文字渲染用 SVG → Three.js mesh(KRIG 实战检验过的方案,HTML overlay 实测效果不好已被否决)
- KRIG 已有 Three.js 经验积累(fitToContent / setSize Retina / SVG label 退化几何防御等)

详见 [docs/graph/basic/BasicView.md §2.3 决策 3](../basic/BasicView.md)。

### 5.4 view 注册

```ts
// src/plugins/graph/variants/family-tree/register.ts
import { graphVariantRegistry } from '../../basic/registry';

graphVariantRegistry.register({
  id: 'family-tree',
  label: '族谱',
  icon: '👨‍👩‍👧',
  matcher: (note) =>
    note.frontmatter?.view === 'graph' &&
    note.frontmatter?.variant === 'family-tree',
  Component: FamilyTreeView,
});
```

**关键**:family-tree **不是独立 view 类型**(KRIG view 类型是 NoteView / Graph / EBookView 等),而是 **Graph view 的 variant**。NavSide 看到带 `view: graph` + `variant: family-tree` frontmatter 的 note,通过 Graph view 用 family-tree variant 打开。

## 6. 入口集成

### 6.1 NavSide

NavSide 里 note 列表显示族谱 note 时,用专属图标(👨‍👩‍👧)区分。(用户说"navSide 部分可以使用,中间重构了一次 navSide" — 复用现有 NavSide note 树渲染)

### 6.2 创建族谱 note

复用现有"+ 新建笔记"流程,提供模板:
- 用户点 NavSide "+ 笔记"
- 弹出"选模板":普通笔记 / 族谱(family-tree)
- 选族谱模板 → 创建一篇带 `view: family-tree` frontmatter 的空 note

**v1 简化**:不做模板选择 UI,用户手动加 frontmatter 即可。或者从 markdown 导入(`graph_variant: family-tree` → `view: family-tree`)。

### 6.3 markdown 导入

复用现有 markdown 导入路径(import/parser),加识别:
- frontmatter `view: family-tree` → 创建 note 时存上,NavSide 用 family-tree 图标
- markdown 内容里的 `# 人物 [[id]]` + 关系列表正常解析为 note 内容

## 7. v1 实施分阶段

### M1:BasicView 共享底座(1.5-2 天,从零构建)

- **不** cherry-pick 旧代码(避免历史包袱),从零构建 `src/plugins/graph/basic/`:
  - M1a: 注册中心接口设计 + Three.js SceneManager(scene/camera/RAF)— 0.5 天
  - M1b: 5 个原始 shape(rect / circle / line / arrow / rounded-rect)+ ShapeRegistry — 0.5 天
  - M1c: SVG label 系统(SvgGeometryContent + 1-2 种 label 布局)+ LabelRegistry — 0.5 天
  - M1d: InteractionController(pan / zoom / 单选 / drag)+ Substance 注册中心 — 0.5 天
- 主动应用 KRIG memory 里的踩坑经验(Retina setSize / fitToContent NaN 等)
- 详见 [docs/graph/basic/BasicView.md §1 + §4](../basic/BasicView.md)

**交付**:能 import basic 模块并注册一个 variant(空 variant,只验证接口可用)

### M2:family-tree parser(0.5 天)

- 写 `variants/family-tree/parser/parse-note.ts`:输入 markdown 字符串,输出 `{ nodes, edges }`
- 写 unit test:红楼梦小子集(贾政 + 王夫人 + 贾宝玉 + 贾环 等 5-6 人)
- 验证:解析输出符合 §2 数据契约

### M3:family-tree 布局算法(1 天)

- 写 `variants/family-tree/layout/walker-tidy.ts`:输入 `{ nodes, edges }`,输出 `positions Map<nodeId, {x,y}>`
- 处理:多代分层 + 配偶并排 + sibling bar 共享 + 多配偶 + Walker apportion 防重叠
- 单元测试:同上小子集,验证 5-6 人位置合理

### M4:family-tree projection + 视觉(1 天)

- 写 `variants/family-tree/projection/visual-rules.ts`:节点属性 → BasicView shape/style 映射
  - 性别色 / 嫡庶尺寸 / 已故斜线 / 占位虚线
- 写 `variants/family-tree/projection/spouse-line.ts`:婚姻线生成(粗细 / 线型 / 斜线标记)
- 写 `variants/family-tree/projection/parent-edge.ts`:drop+sibling-bar+stub 三段直角
- 写 `variants/family-tree/FamilyTreeView.tsx`:集成 parser + layout + projection,通过 BasicView 注册中心拿 shape 渲染

### M5:Graph view 注册 + NavSide 入口 + markdown 导入(0.5 天)

- 注册 Graph view 类型 + family-tree variant
- NavSide 识别 frontmatter `view: graph` + `variant: family-tree`,用专属图标
- markdown 导入 frontmatter 校验

### M6:红楼梦 CSV → markdown 转换 + 调优(0.5 天)

- 写一次性转换脚本:`docs/test-data/honglou/relation_refined.csv` → markdown
- 关系类型归一(父亲/儿子等 → parent;夫人/丈夫 → spouse;丫环/朋友等 → 略)
- 嫡庶 + 已故清单(参考红楼梦原著手工补)
- 完整渲染验收

**合计 4.5-5 天**(BasicView 从零构建 1.5-2 天 + family-tree variant 3 天)。

注:M1 BasicView 工作量计入 family-tree v1,因为 family-tree 是 BasicView v1 的第一个消费者(也是验证用例)。后续 variants(knowledge / mindmap)实施时,BasicView 复用,不再计入。

为什么"从零构建"比 cherry-pick 旧代码慢 0.5 天却仍然选择:旧代码隐含已删除模块的架构假设,重构成本经常比从零写还大;且 KRIG 关键经验已在记忆里,代码不需要继承。详见 [BasicView.md §1.2](../basic/BasicView.md)。

## 8. 验收标准

### 红楼梦核心(主验收)

数据来源:`docs/test-data/honglou/relation_refined.csv` 转换 + 嫡庶/已故人工标注。

- [ ] markdown 导入成功,识别为 family-tree variant
- [ ] family-tree view 渲染:
  - [ ] 5 代结构清晰(贾演 → 贾代化/贾代善 → 贾敬/贾政 → 贾珠/贾宝玉 → 贾兰)
  - [ ] 配偶横线正确(贾政—王夫人 / 贾赦—邢夫人 / 林如海—贾敏 ...)
  - [ ] 多子女共享 drop + sibling bar(贾政→元春/珠/宝玉/探春/环 5 个子女共享)
  - [ ] 跨家族婚姻不出错(林家通过贾敏与贾家相连,5 大家族图谱整体连通)
  - [ ] 性别色正确(男蓝 / 女粉)
  - [ ] 已故斜线 + 颜色降饱和度(贾代善 / 贾敏 / 林如海 / 贾珠)
- [ ] **嫡庶视觉**(还原历史真实):
  - [ ] 王夫人(rank=principal)与赵姨娘(rank=secondary)同代并存,均连贾政
  - [ ] 王夫人婚姻线 1.5px(粗);赵姨娘婚姻线 1px(细)
  - [ ] 贾环(legitimate=false)节点 140×50 + 虚线;贾宝玉(默认 true)160×60 + 实线 — **明显视觉不同**
- [ ] **同时多妻**(贾珍家):尤氏 + 佩凤 + 偕鸾同代并排 — 不重叠不混乱

### 通用回归

- [ ] 切换其他 note variant(普通笔记 / ...)不受影响
- [ ] family-tree note 与普通 note 数据互通(同一 note 系统)
- [ ] typecheck 0 错误
- [ ] 拖动 / 缩放 / 平移流畅(SVG transform)

## 9. 不做(留 v1.5+)

| 功能 | 留待 |
|---|---|
| 祖先视图(向上展开) | v1.5 |
| 沙漏视图 | v2 |
| 扇形图 | v2 |
| 用户拖动节点 + 持久化位置 | v1.5 |
| 双胞胎 / 三胞胎符号 | v1.5 |
| 照片缩略图 | v1.5 |
| GEDCOM .ged 文件导入 / 导出 | v1.5 |
| sibling 边显式渲染(目前由 parent 推导) | v1.5 |
| 点击节点跳到对应 note(noteId↔nodeId 互引) | v1.5 |
| NoteView block 自动派生 atom(语义层接通) | v1.5+ |
| 时间轴模式(y = birth_year) | v2 |
| 与其他 view 互通 UI 切换 | v2 |

## 10. 参考资料

- [GEDCOM 5.5.1 spec](https://en.wikipedia.org/wiki/GEDCOM)
- [GRAMPS 源码 — pedigreeview.py](https://github.com/gramps-project/gramps/blob/main/gramps/plugins/view/pedigreeview.py)
- [entitree-flex](https://github.com/codeledge/entitree-flex)(Walker tidy tree + couple-as-side-node)
- [GenoPro genogram rules](https://genopro.com/genogram/rules/)
- van der Ploeg, A.J., *"Drawing Non-Layered Tidy Trees in Linear Time"*, 2013

## 11. 备份(历史)

之前的 family-tree spec 实验在 `backup/before-pg-refactor-2026-04-28` 分支,共 v1 + v2 两版,展示了从"专属图谱模块" → "Property Graph 重构" → "view 组件"的演进过程。当前 spec 是最终简化版。
