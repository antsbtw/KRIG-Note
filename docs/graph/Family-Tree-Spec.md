# Family Tree 视图规范 v2

KRIG Graph 的"族谱"渲染变种。

## 0. 架构基石

### 0.1 KRIG 三层架构

```
┌──────────────────────────────────────────────────────────┐
│ 语义层 (Semantic Layer)                                   │
│   block — 承载知识本体(在 NoteView 里编辑富文本/公式/etc) │
│   ↓ 派生 / 索引(v1.5+ 自动;v1 用户显式写)                 │
├──────────────────────────────────────────────────────────┤
│ 表征层 (Presentation Layer) — 每个 view 各自一份         │
│                                                          │
│   NoteView 表征层      Graph 表征层                       │
│   ─────────────       ─────────────                      │
│   block 直接显示      geometry(节点形状)                 │
│                       intension atom(属性索引)           │
│                       presentation atom(视觉覆盖)        │
├──────────────────────────────────────────────────────────┤
│ View 层 (Render Layer)                                   │
│   NoteView 渲染   Graph 渲染(family-tree / knowledge)    │
└──────────────────────────────────────────────────────────┘

跨 view 互引:noteId / nodeId 各自独立,但可互相引用
```

**关键约束**:
1. **语义层是真理之源**(block),其他都是它的影子
2. **表征层只读 / 派生,不改语义层**:Graph 视图的 atom 是从 block 抽取的索引,Graph 不能改写 block 内容
3. **后续架构升级只能叠加,不能动语义层**:加新 view(timeline / matrix 等)= 加新表征层,语义层 block 不变

### 0.2 数据通用,视图专属

```
   block(语义层)
            │  各 view 各自抽取需要的索引
   ┌────────┼────────┬────────┐
   ▼        ▼        ▼        ▼
 family-  knowledge  org-    timeline
 tree     graph     chart    (...)
```

同一份红楼梦数据,在 family-tree ViewMode 显示族谱(突出血亲与配偶),在 knowledge graph ViewMode 显示关系网(显示主仆 / 师徒 / 朋友),在未来 ViewMode 显示别的。

### 0.3 nodeId 与 noteId 是两个 view 的独立身份

```
NoteView 视图              Graph 视图
─────────────             ─────────────
note (noteId)             node (nodeId)
  - 一篇笔记                - 一个图谱节点
  - 可被多个 node 引用      - 可引用多篇 note
  - 互引通过 [[noteId]] /   - 互引通过 [[nodeId]] /
    [[nodeId]]                [[noteId]]
```

**两个 view 的身份独立,但有互引能力**。一篇 note 可能在多个图谱里出现(多个 nodeId 关联);一个 graph 节点可能引用多篇 note(综合性节点)。

### 0.4 v1 范围

**v1 family-tree 只在 Graph 表征层做事**:
- 用户在 markdown 里**显式写** intension atom(`gender :: M`、`relation :: parent` 等)
- family-tree projection 读这些 atom 渲染族谱
- **不动语义层**(block 层 v1 不接通)
- **不动其他 view**(NoteView 不变)

v1.5+ 才接通 block ↔ atom 派生机制(NoteView 写人物传记 → Graph 自动 index)和 nodeId ↔ noteId 互引。

详见 §13 演进路径。

## 1. 设计原则

1. **数据通用,视图专属**(本架构基石,见 §0)。族谱不需要专属数据格式,沿用 KRIG 现有的"Point geometry + Line geometry + intension atom"。
2. **最小本原**:整个图就两件东西 — 节点(Point)和边(Line)。Family / ChildLink / Marriage 等都不是独立实体,都是边的属性。
3. **算法读结构,视觉读属性**。布局算法只看"谁连谁 + 关系类型",不读 spouse_rank / placeholder / gender 等文化语义;视觉规则只看节点 / 边的属性,自动呈现差异。
4. **还原历史真实,不抹平文化差异**。视觉默认区分嫡庶、正侧、虚线表达私生 / 收养等真实关系。用户填数据怎样,视觉就忠实呈现怎样。
5. **对标经典专业族谱工具**(GenoPro / GRAMPS / MyHeritage / Family Tree Maker)。红楼梦只是首批验证用例。
6. **先做好经典,再考虑互通**。v1 只交付 family-tree ViewMode 渲染。互通问题不需要单独设计 — 只要每个 ViewMode 都尊重"通用图数据 + 专属渲染"架构,互通自然涌现。
7. **数据模型只叠加,不推翻**(关键架构约束)。后续架构升级(block 层 / 跨 view 互引等)必须**在语义层 block 之上叠加**,不替换、不改写、不污染 block。Graph 视图的 atom 是 block 的派生索引,只读 / 只查询,永不改写 block 内容。语义层是真理之源,任何变更都不能动它。

## 2. 数据模型

### 2.1 节点(Point geometry)

唯一身份(KRIG geometry id) + 任意属性(intension atom)。

族谱场景下,每个节点是一个人物。属性按需填:

| 属性(predicate) | 值 | 说明 | 渲染层用途 |
|---|---|---|---|
| `substance` | `family/person`(固定) | 标识这是族谱节点 | 决定 ViewMode 视觉规则 |
| `label` | string | 显示用姓名 | 节点文字 |
| `gender` | `'M'` \| `'F'` \| `'O'` \| `'U'` | 男 / 女 / 其他 / 未知 | 节点填充色 |
| `birth_date` | `'YYYY'` 或 `'YYYY-MM-DD'` | 出生 | 节点第二行 + 兄弟排序 |
| `death_date` | `'YYYY'` 或 `'YYYY-MM-DD'` | 死亡 | 节点斜线 + 颜色饱和度 + 第二行 |
| `legitimate` | `true` \| `false` | 嫡 / 庶 | 节点尺寸 + 边框线型 |
| `placeholder` | `true` | 占位人物 | 虚线框 + `?` 文字 |

**只有 `substance: family/person` 是必填**,其他都可省。属性缺失时视觉降级到"标准节点视觉"。

#### 关于 legitimate 属性的说明

legitimate 是一个**节点直接属性**,而不是从父族谱推导。理由:
- 用户**显式表达**"这是庶出"——尊重"还原真实"原则,用户决定数据要写多详细
- 数据简单,无需图遍历推导
- 历史族谱里"嫡庶"本身就是登记在册的人物属性,不是动态计算的

不写 legitimate → 默认 true(标准节点视觉),不区分。

### 2.2 边(Line geometry)

`members` 数组([source, target]) + 任意属性(intension atom)。

| 属性(predicate) | 值 | 说明 |
|---|---|---|
| `relation` | `'parent'` \| `'spouse'` \| `'sibling'` \| `'servant'` \| `'mentor'` \| `'friend'` \| `'other'` | 关系语义类型(family-tree projection 只渲染前 3 种,后面的留给其他 ViewMode) |
| `sub_type` | string | 关系细分(见下) |
| `marriage_order` | `1` / `2` / `3` ... | 仅 spouse 边:在 source 人生中的婚姻次序 |
| `marriage_status` | `'married'` \| `'unmarried'` \| `'civil_union'` \| `'divorced'` \| `'separated'` \| `'unknown'` | 仅 spouse 边:婚姻状态 |
| `rank` | `'principal'` \| `'secondary'` \| `'unknown'` | 仅 spouse 边:配偶层级(对应中国"正/妾"、欧洲"正室/情妇"等) |
| `concurrent_with` | `[[edge-id], [edge-id]]` | 仅 spouse 边:与之并存的其他 spouse 边(区分"再婚"与"同时多妻") |

**relation 枚举值**:

| 值 | 描述 | family-tree 渲染? |
|---|---|---|
| `parent` | 父母→子女 | ✅ |
| `spouse` | 配偶 | ✅ |
| `sibling`(可选) | 兄弟姐妹(可由 parent 推导,通常省略) | ✅ |
| `servant` | 主仆 / 雇佣 | ❌(其他 ViewMode 显示) |
| `mentor` | 师徒 / 师生 | ❌ |
| `friend` | 朋友 / 好友 / 熟人 | ❌ |
| `other` | 其他暂无分类的 | ❌ |

**sub_type 用途**:
- `relation=parent` 时:`birth` / `adopted` / `foster` / `step` / `unknown`(决定 ChildLink 视觉:实线 vs 虚线)
- `relation=spouse` 时通常不用(用 marriage_status 表达)
- `relation=servant/mentor/friend` 时:细分(`maid` / `bodyguard` / `master` / `disciple` / `lover` 等)
- 不填 → 默认 `birth`(parent)或 unspecified(其他)

#### 关于不引入 Family 节点的说明

之前 v1 spec 设计了"Family 隐形锚点节点"对齐 GEDCOM。重新审视后否决:
- KRIG 通用图模型已经有"节点 + 边",再加一层"婚姻锚点"是叠床架屋
- 婚姻锚点位置完全可以由"两个 spouse 节点的中点"动态计算(layout 算法做)
- 多子女共享 sibling bar 可以由 projection 在渲染时根据"共同 parent 集合"分组生成
- 数据冗余:Family 节点本身没有任何独立属性(都可以挂在 spouse 边上)
- GEDCOM 互通(v1.5+ 加)时再用一个 import/export 适配器做映射,不污染核心模型

### 2.3 markdown 格式

沿用 KRIG 现有 markdown 格式,**不为族谱特化**。frontmatter 加 `graph_variant: family-tree` 标识。

```markdown
---
title: 红楼梦人物族谱
graph_variant: family-tree
---

# 贾政 [[jia-zheng]]

- substance :: family/person
- gender :: M
- birth_date :: 1700

# 王夫人 [[wang-furen]]

- substance :: family/person
- gender :: F

# 配偶关系-贾政王夫人 [[edge-jz-wfr]]

- substance :: krig-line  # 通用 line
- members :: [[jia-zheng]] [[wang-furen]]
- relation :: spouse
- marriage_order :: 1
- rank :: principal
- marriage_status :: married

# 父子关系-贾政贾宝玉 [[edge-jz-jby]]

- substance :: krig-line
- members :: [[jia-zheng]] [[jia-bao-yu]]
- relation :: parent
- sub_type :: birth
```

**关键**:边的 substance 仍然是通用 `krig-line`(KRIG 已有),不需要 `family/child-link` 这种专属类型。relation 属性区分语义。

### 2.4 与 KRIG 通用图谱的兼容性

family-tree 数据**完全是合法的 KRIG 通用图谱数据**:
- 切到 knowledge graph ViewMode → 看到所有节点 + 所有边(含 servant / mentor 等)
- 切到 family-tree ViewMode → 只看到 parent + spouse + sibling 边,按族谱规则布局
- 同一份数据,两种视图

## 3. 视觉规范

照搬专业族谱工具(GenoPro / GRAMPS)共识。**全部规则都是属性 → 视觉的映射**,无算法分支。

### 3.1 节点视觉(Person)

视觉规则按属性查表(都是简单 if):

| 属性 | 默认 | 视觉效果 |
|---|---|---|
| `gender=M` | — | 填充浅蓝 `#a8c7e8` |
| `gender=F` | — | 填充浅粉 `#e8a8c0` |
| `gender=O` | — | 填充浅灰 `#c0c0c0` |
| `gender=U` 或缺失 | ✓ | 填充深灰 `#888` |
| `legitimate=false` | — | 尺寸 140×50(默认 160×60),边框虚线 |
| `placeholder=true` | — | 边框虚线 + 文字 `?` 替代姓名 + 不画 b./d. |
| `death_date` 存在 | — | 左上角对角斜线(`(0,10)→(10,0)`,1px 黑) + 填充饱和度 50% |
| `birth_date` 存在 | — | 节点第二行显示 `b. YYYY` |
| `death_date` 存在 | — | 节点第二行显示 `d. YYYY` |
| 都存在 | — | `b. YYYY – d. YYYY` |

**优先级**:`placeholder=true` 视觉优先于 `legitimate=false`(占位是元信息,优先呈现)。

视觉示例(贾政家):
- 王夫人(`gender=F`,`legitimate` 不写):浅粉 + 160×60 + 实线
- 赵姨娘(`gender=F`):浅粉 + 160×60 + 实线(人物本身在族谱里地位由 spouse 边的 `rank=secondary` 体现,**不在节点视觉**)
- 贾宝玉(`gender=M`):浅蓝 + 160×60 + 实线
- 贾环(`gender=M`,`legitimate=false`):浅蓝 + 140×50 + 虚线
- 贾代善(`gender=M`,`death_date=1740`):浅蓝降饱和 + 160×60 + 左上角斜线 + 第二行 `d. 1740`

### 3.2 边视觉

#### relation=parent(父子边)

父子边渲染为"drop + sibling bar + stub"三段直角(经典族谱外观,GenoPro/GRAMPS/Murdock 共识):

```
        父母对(由 layout 算出婚姻线中点)
              |        ← drop line
              |
       ┌──────┴──────┐ ← sibling bar(横向跨同父母兄弟)
       |             |
     [child]       [child]   ← stub
```

projection 渲染时:
1. 按"共同 parent 集合"分组所有 parent 边(同父母的兄弟共享一组中间几何)
2. 每组生成一条 drop + 一条 sibling bar
3. 每个 child 一条 stub

线宽:1.5px,色 `#666`。

`sub_type` 决定线型(每条 stub 自己的样式,不影响共享 bar):
- `birth`(默认):实线
- `adopted`:虚线 9-4
- `foster`:点线 2-3
- `step`:虚线 9-4
- `unknown`:虚线 9-4

#### relation=spouse(配偶边)

水平横线在两人 y 平均位置,**由 layout 保证两 spouse 同 y**。

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

#### relation=sibling(兄弟边,可选)

通常省略(由共同 parent 推导)。如果显式存在,渲染为"sibling bar 上的兄弟连线"。

#### 其他 relation(servant / mentor / friend 等)

family-tree projection **不渲染**。这些边在数据上保留,切到其他 ViewMode 时显示。

## 4. 布局算法

新建 `src/plugins/graph/layout/family-tree.ts`,**不接 ELK**。算法读结构(节点 + relation 属性),不读文化语义。

### 4.1 输入识别

- **族谱节点**:`substance = family/person` 的 Point geometry
- **父子边**:`relation = parent` 的 Line geometry
- **配偶边**:`relation = spouse` 的 Line geometry
- **其他 line**:忽略(family-tree 不渲染)

### 4.2 算法(三步走,无文化分支)

#### 第 1 步:建索引

```
parents(person)      = 该 person 作为 child(parent 边的 target)所有 source 节点
children(person)     = 该 person 作为 parent(parent 边的 source)所有 target 节点
spouses(person)      = 与该 person 之间存在 spouse 边的所有节点
spouseEdge(a, b)     = 两 person 之间的 spouse 边(可选,取属性用)
parentEdge(p, c)     = parent 边对象(取 sub_type 等属性用)
```

注意:**parent 边方向规定 source=parent, target=child**。markdown 导入时自动按 relation 文本归一(中文"儿子"反向,"父亲"正向,等)。

#### 第 2 步:代际分配(generation)

- 主人公(graph 第一个 family/person 节点)generation = 0
- BFS 向下:对主人公及其配偶的所有 children → generation = 1,递归
- BFS 向上(v1 简化:不画祖先,主人公就是树根)
- 主人公的所有配偶 generation 同主人公(同代)

如果数据里有"配偶不同代"(如老夫少妻跨代),按出现的最早 generation 归属(罕见,v1 接受少量错位)。

#### 第 3 步:同代 x 排布(Walker tidy tree 变种)

参考 [entitree-flex](https://github.com/codeledge/entitree-flex)(Walker + couple-as-side-node)。

**核心逻辑**:
1. 按代从底层(最大 generation)向上算
2. 叶子节点按 `birth_date` 升序排;缺失则按 markdown 出现顺序
3. 父代节点 x 由其 children 的 x 范围决定:`(leftmostChild.x + rightmostChild.x) / 2`
4. 配偶节点排在主人公左右(同 y):
   - 单 spouse:配偶在 person 一侧(左或右,看哪侧空)
   - 多 spouse:按 `marriage_order` 升序向同一方向扩展(主人公居中,所有配偶向右扩,或对称)
5. 婚姻锚点(虚拟,不渲染)= 两 spouse 中点,作为 drop-line 起点
6. Walker 算法处理同代不重叠

**算法不读 spouse_rank / legitimate / placeholder 等属性** — 这些只在视觉层使用。

**多 spouse 的两种语义(serial vs concurrent)由数据自然区分**,算法无需分支:
- `concurrent_with` 空(serial):多个 spouse 边按 marriage_order 排列,每段独立
- `concurrent_with` 互链(concurrent):同时存在,算法仍然按 marriage_order 排列(布局上无区别),视觉上由 §3.2 表现差异
- 实际效果:两种情况算法输出一致,视觉(婚姻线粗细 + 节点尺寸)在用户填的属性差异下自动呈现"再婚"vs"同时多妻"差异

### 4.3 输出

`LayoutOutput`:
- `positions`: 每个 family/person 节点的中心(x, y)
- `edgeSections`: 留空(由 family-tree projection 渲染时根据节点位置 + 边的 relation 属性动态生成 drop+bar+stub 等几何)

### 4.4 默认参数

| 参数 | 默认 | 用户可调 |
|---|---|---|
| `layout.spacing.sibling` | 30 | ✅ |
| `layout.spacing.couple` | 10 | ✅(配偶之间间隔) |
| `layout.spacing.layer` | 120 | ✅(代际间距) |

direction / edge-style 不消费 — 族谱永远"上代在上、下代在下"。

## 5. Projection

新建 `src/plugins/graph/projection/built-in/family-tree.ts`。

### 5.1 婚姻线渲染

扫描所有 `relation=spouse` 的 Line geometry,在两 spouse 节点之间画水平线。线粗 / 线型由 §3.2 规则决定。

### 5.2 父子边渲染(drop + sibling bar + stub)

按"共同 parent 集合"分组父子边:

```
groupBy(parentEdge => sortedTuple(parents(parentEdge.target)))
```

每组生成一条 drop + 一条 sibling bar:
- drop 起点 = 共同 parent 集合的中点(若有 spouse 边,中点 = 婚姻线中点;否则 = 单亲 parent 节点正下方)
- drop 终点 = 父代 y 与子代 y 的中间
- sibling bar 横向跨该组所有子节点的 x 范围
- 每个子节点一条 stub(从 sibling bar 到子节点顶部),线型按 sub_type

### 5.3 节点视觉

由 substance 视觉配置直接驱动(不在 projection 写)。`family/person` substance 在注册时声明 visual 属性映射规则,渲染层根据节点的 atom 自动应用。

具体方案:扩展现有 RoundedRectShape,使其能根据节点 visual 中的 `family.legitimate` / `family.placeholder` / `family.deceased` 等 flag 调整尺寸 / 线型 / 装饰。这些 flag 由 adapter 在 atom → visual 时根据节点属性派生。

## 6. ViewMode 注册

```ts
viewModeRegistry.register({
  id: 'family-tree',
  label: '族谱',
  layout: 'family-tree',
  projection: 'family-tree',
  enable_patterns: false,
});
```

## 7. 入口集成

| 改动点 | 文件 |
|---|---|
| AVAILABLE_VARIANTS 加 family-tree | `src/plugins/graph/navside/useGraphOperations.ts` |
| GraphVariant 类型加 'family-tree' | `src/main/storage/types.ts` |
| 新建图自动设 active_view_mode | `src/main/storage/graphview-store.ts`(根据 variant 推默认 view_mode) |
| markdown frontmatter 校验 | `src/plugins/graph/main/import/parser.ts` 加 family-tree 到 allowlist |

## 8. 版本范围

### v1 必备(本次实施)

| 功能 | 备注 |
|---|---|
| 后代视图(Descendant tree,主人公向下) | 默认且唯一 v1 模式 |
| Person + 通用 Edge 数据模型 | 完全兼容 KRIG 通用图谱 |
| 父子边渲染(drop + sibling bar + stub) | sub_type 决定线型 |
| 配偶边渲染(水平线) | rank 决定粗细,marriage_status 决定线型 |
| 多个配偶处理(serial / concurrent 数据自然区分) | 算法统一,视觉自然差异 |
| 单亲 / 占位 | 数据缺失自然处理 |
| 嫡庶视觉(legitimate 属性) | 节点尺寸 + 边框线型 |
| 已故视觉 | 斜线 + 颜色饱和度 + b./d. 文字 |
| 性别色 | gender 属性 |
| markdown 导入(frontmatter 校验) | |
| NavSide "+ 图谱" 列出族谱 | |

### v1.5

| 功能 | 备注 |
|---|---|
| 祖先视图(Ancestor pedigree) | 2^n 网格 |
| 点击换主人公(reroot) | |
| 添加家庭成员 UI | |
| 双胞胎符号 | |
| 照片 | |
| GEDCOM .ged 导入导出 | |
| sibling 边显式渲染 | |

### v2

| 功能 | 备注 |
|---|---|
| 沙漏视图 | |
| 扇形图 | |
| 时间轴 | |
| 与其他 ViewMode 互通的 UI 切换 | 数据本就互通,只是视图切换 |

## 9. 测试数据

### 9.1 红楼梦核心(首批验证 — 含嫡庶)

`docs/graph/samples/Family-Tree-Hongloumeng.md` — 红楼梦核心人物族谱,从 `docs/graph/samples/data/relation_refined.csv` 转换而来。

#### 数据来源

用户已提供:
- `name_use.csv`(84 条别名映射)
- `name_clean_sorted.csv`(302 条清洗后人名)
- `relation_refined.csv`(189 条关系)

#### 转换流程(一次性脚本 `scripts/convert-honglou.ts`)

1. 读 CSV
2. 双向冗余去重(贾政→贾宝玉"父亲" + 贾宝玉→贾政"儿子" → 一条 parent 边)
3. 关系类型归一:
   - 父亲/母亲/儿子/女儿 → `relation=parent`(方向调整为 parent→child)
   - 夫人/丈夫 → `relation=spouse`
   - 兄/姐/弟/妹 → `relation=sibling`(可选,可省)
   - 丫环/老奴/陪房 → `relation=servant` 
   - 老师/师父 → `relation=mentor`
   - 朋友/好友/相好/暧昧 → `relation=friend`
   - 主人/孙子/侄女 等 → `relation=other`
4. 输出 markdown(节点 + 边)

#### 嫡庶 / 已故标注(人工补)

CSV 没有这些信息,需根据红楼梦原著手工补:
- `legitimate=false` 标注:贾环(赵姨娘所生,庶子)
- `death_date` 标注:贾代善 / 贾敏 / 林如海 / 贾珠 等已故
- spouse 边的 `rank=secondary` 标注:赵姨娘&贾政、佩凤&贾珍、偕鸾&贾珍、秋桐&贾赦、尤二姐&贾琏、香菱&薛蟠 等

我(实施时)整理一份"嫡庶 + 已故清单",作为脚本的补充配置文件 `scripts/honglou-overrides.json`,你 review 后定稿。

#### v1 必验场景(red 自天然覆盖)

- ✅ 多代深度(贾演→贾代化→贾敬→贾珍→贾蓉,5 代)
- ✅ 多子女(贾政→元春/珠/宝玉/探春/环)
- ✅ 同时多妻(贾政=王夫人 principal + 赵姨娘 secondary;贾珍=尤氏+佩凤+偕鸾)
- ✅ 嫡庶视觉(贾宝玉嫡 vs 贾环庶)
- ✅ 跨家族婚姻(林如海&贾敏 → 林黛玉,5 大家族网)
- ✅ 已故标记(贾代善 / 贾敏 / 林如海 / 贾珠)
- ✅ 切到 knowledge graph ViewMode 仍显示主仆 / 朋友等其他关系(验证"数据通用 + 视图专属"架构)

### 9.2 后续测试数据(v1 实施后,空闲时补)

- 亨利八世六次婚姻(顺序多婚 + 离婚视觉)
- 占位 + 单亲专项

红楼梦核心已经覆盖 v1 必验的所有场景,9.2 留作可选扩充。

## 10. 实施阶段

| 阶段 | 内容 | 预计 |
|---|---|---|
| 0 | 本 spec | ✅ |
| 1 | 数据准备:`family/person` substance 注册 + CSV→markdown 转换脚本 + 嫡庶/已故清单 | 0.5 天 |
| 2 | family-tree 布局算法(代际分配 + Walker tidy tree + 多 spouse) | 1 天 |
| 3 | family-tree projection(婚姻线 + drop+bar+stub) | 0.5 天 |
| 4 | 节点视觉(legitimate / placeholder / deceased / gender 全套属性映射) | 0.5 天 |
| 5 | ViewMode 注册 + NavSide 入口 + GraphVariant 扩展 + frontmatter 校验 | 0.5 天 |
| 6 | 红楼梦验收 + 调优 | 0.5 天 |

合计 **3.5 天**(比 v1 spec 的 5 天少 1.5 天 — 数据模型简化 + 算法分支砍掉)。

**每阶段交付暂停点**:
- 阶段 1 → 给 markdown + 嫡庶清单 review
- 阶段 2 → console 打节点位置 + 简单可视化
- 阶段 3 → 红楼梦核心简化版渲染(只有 parent + spouse,无嫡庶视觉)
- 阶段 4 → 完整红楼梦
- 阶段 6 → 全验收

## 11. 验收标准

### 红楼梦核心

- [ ] markdown 导入成功,自动识别为 family-tree variant
- [ ] 切到 family-tree ViewMode:
  - [ ] 5 代分层清晰
  - [ ] 配偶横线正确
  - [ ] 多子女共享 drop + sibling bar
  - [ ] 5 大家族通过婚姻边连接(不孤立)
  - [ ] 性别色正确
  - [ ] 已故人物斜线 + 饱和度降低
  - [ ] **嫡庶视觉差异**:贾宝玉(嫡)160×60 实线 vs 贾环(庶)140×50 虚线 一眼可分
  - [ ] 同时多妻:贾政→王夫人(principal,1.5px 婚姻线) + 赵姨娘(secondary,1px 婚姻线) 同代并排,视觉差异自然涌现
- [ ] 切到 knowledge graph ViewMode:
  - [ ] 同份数据,可见 servant / friend 等其他关系边(验证数据通用)

### 通用回归

- [ ] 切换其他 variant(knowledge / basic)不受影响
- [ ] family-tree variant 与 knowledge variant 数据互通(切 ViewMode 即可)
- [ ] typecheck 0 新错误
- [ ] 拖动节点:婚姻线 + drop+bar+stub 即时跟随(走 GraphRenderer 的 updateConnectorsFor;v1 接受拖动期间简化为直线兜底)

## 12. 参考资料

- v1 spec 备份:`docs/graph/Family-Tree-Spec.v1.md.bak`(架构变化前的版本,含 Family/ChildLink 抽象)
- [GEDCOM 5.5.1 spec](https://en.wikipedia.org/wiki/GEDCOM)(v1.5 GEDCOM 互通时再细读)
- [GRAMPS 源码 — pedigreeview.py](https://github.com/gramps-project/gramps/blob/main/gramps/plugins/view/pedigreeview.py)
- [entitree-flex](https://github.com/codeledge/entitree-flex)(Walker tidy tree + couple-as-side-node)
- [GenoPro genogram rules](https://genopro.com/genogram/rules/)
- van der Ploeg, A.J., *"Drawing Non-Layered Tidy Trees in Linear Time"*, 2013

## 13. 与 v1 spec 的主要差异

### 13.1 v1 → v1.5 → v2 演进路径

| 版本 | 节点数据来源 | 用户写法 | 视觉如何获得属性 |
|---|---|---|---|
| **v1**(本次) | 用户在 markdown 直接写 intension atom | `# 贾宝玉`<br>`- gender :: M`<br>`- birth_date :: 1716` | family-tree projection 直接读 atom |
| **v1.5** | 用户在 NoteView 写人物 note(语义层 block) | `# 贾宝玉的人物传记`<br>正文:"贾宝玉,生于 1716 年..."<br>**结构化标记**:`<gender>M</gender>`、`<birth>1716</birth>`(具体语法待定) | 派生器从 block 抽取 atom,projection 用法不变 |
| **v2** | nodeId ↔ noteId 完整互引 | 同上 + 在族谱节点点开 → 跳到对应 note 编辑;note 里 `[[nodeId]]` 可链接节点 | 同 v1.5 + 用户从节点交互直接编辑 note |

**关键不变量**(三个版本都遵守):
- 语义层 block 永不被算法 / 视觉改写
- intension atom 始终是表征层产物(v1 用户手写,v1.5+ 自动派生)
- family-tree projection 的渲染逻辑不变(始终读 atom)

### 13.2 与 v1 spec(已废弃)的差异

| v1 spec(已废弃) | v2 spec(本) |
|---|---|
| Family 节点(隐形锚点) | 删除,中点动态算 |
| ChildLink 边(专属类型) | 删除,通用 line + relation 属性 |
| family/family substance | 删除 |
| family/child-link substance | 删除 |
| 算法 6a/6b/6c 三种分支 | 单一分支(serial / concurrent 数据自然区分) |
| 嫡先庶后排序(算法读 spouse_rank) | 删除,算法不读文化语义 |
| 节点视觉派生(从父母 spouse_rank 推导嫡庶) | 改为节点直接属性 `legitimate` |
| 5 天实施 | 3.5 天(简化后) |
| 4 套测试数据 | 1 套核心(红楼梦)+ v1 后可选扩充 |
| 缺失三层架构声明 | §0 明确 语义/表征/View 三层 |
| 缺失 nodeId/noteId 关系声明 | §0.3 明确两个 view 身份独立 + 可互引 |
| 缺失数据模型叠加约束 | §1.7 明确"只叠加,不动语义层" |
