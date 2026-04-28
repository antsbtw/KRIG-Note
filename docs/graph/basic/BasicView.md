# BasicView — Graph 共享底座

KRIG Graph view 的**画板基础设施**,所有 Graph variants(family-tree / knowledge / mindmap / ...)共享。

## 0. 架构定位

### 0.1 在 KRIG view 体系中

```
KRIG views (顶层视图):
├── NoteView   (笔记)
│     └── variant: thought
├── EBookView  (电子书)
├── WebView    (网页)
└── Graph      (图谱)
      ├── BasicView (共享底座 — 本 spec)
      ├── variant: family-tree    (族谱)
      ├── variant: knowledge      (知识图谱,后续)
      ├── variant: mindmap        (思维导图,后续)
      └── ...
```

**BasicView 不是 Graph 的 variant,而是 Graph 内所有 variants 共享的底座**。

### 0.2 类比

| BasicView 类比 | variant 类比 |
|---|---|
| Photoshop / Figma 的画板基础(图层 / 工具 / 选择 / 变换) | Photoshop 的"族谱模板" / Figma 的 Components |
| macOS Freeform / tldraw / Excalidraw 的画板核心 | 在画板核心上做的特定渲染逻辑 |

**关键定义**:**凡用 Three.js 渲染的 Graph view 都是 BasicView 的扩展**。

### 0.3 BasicView 提供什么

承载**通用画板工件**(共享设施):

| 类别 | v1 提供 |
|---|---|
| **Three.js 基础** | scene 管理 / camera / renderer / RAF / 坐标系 |
| **Shape 库** | rect / circle / line / arrow / text-label(5 个原始 shape) |
| **Substance 注册中心** | shape + 语义模板的注册接口(SubstanceRegistry) |
| **连接器系统** | Edge with bindings(2 个 endpoint 各带 magnet) |
| **Label 系统** | 节点 / 边的文字渲染(HTML overlay,CSS2DRenderer) |
| **交互控制器** | pan / zoom / click / drag(单选 v1 ;多选 v1.1+) |
| **样式 token** | 共享颜色 / 字号 / 边宽设计 token |

variants 在 BasicView 之上做的事:
| 类别 | 例 |
|---|---|
| **Layout 算法** | family-tree:Walker tidy tree;knowledge:力导向... |
| **数据 schema** | family-tree:parent/spouse/legitimate;knowledge:type/category... |
| **视觉规则** | 属性如何映射到 BasicView 的 shape/style |
| **特殊几何** | family-tree 的 drop+bar+stub 边;knowledge 的力导向边... |

---

## 1. v1 范围(走向 C — 注册中心架构)

**v1 = "用户不可见的注册中心"**:
- 提供 SubstanceRegistry / ShapeRegistry / LabelRegistry 等代码层接口
- variants 通过这些接口拿 shape + substance
- **用户不能编辑** shape / substance(暂时硬编码,family-tree variant 用什么就硬编码什么)
- BasicView 没有独立的 UI 入口(用户进 family-tree variant 才间接用到 BasicView)

**v1 不做**(留 v1.5+):
- 用户可视化编辑 shape / substance(完整画板编辑器)
- 多选 / 框选 / 对齐 / 吸附
- 撤销 / 重做(undo/redo)
- 序列化为独立文件(暂时 variant 自己管序列化)
- shape 库 panel UI

### 1.1 v1 实施清单

| 模块 | 路径 | 内容 |
|---|---|---|
| Three.js 底座 | `src/plugins/graph/basic/scene/SceneManager.ts` | scene + camera + RAF + 坐标系 |
| Shape 库 | `src/plugins/graph/basic/shapes/` | RoundedRectShape / CircleShape / LineSegmentShape / ArrowShape / HexagonShape |
| Label 系统 | `src/plugins/graph/basic/labels/` | 6 种 layout(above/below/inside-center/inside-top/left/right)+ SvgGeometryContent |
| Substance 注册中心 | `src/plugins/graph/basic/substance/` | substance 注册接口 + 内置 substance(family/person 等) |
| 交互控制器 | `src/plugins/graph/basic/interaction/InteractionController.ts` | pan / zoom / click / drag |
| 注册接口导出 | `src/plugins/graph/basic/index.ts` | shapeRegistry / substanceRegistry / labelRegistry 等 |

### 1.2 BasicView v1 来源

KRIG 历史上的 GraphView 实验里有现成的 Three.js 底座代码(~1800 行,在 `backup/before-pg-refactor-2026-04-28` 分支),包括 SceneManager / shapes / labels / SvgGeometryContent / InteractionController。**这些都是与 GraphView 业务逻辑无关的 Three.js 工具类**,可以直接 cherry-pick 到 `src/plugins/graph/basic/`,作为 v1 BasicView 起点。

cherry-pick 之后的清理工作:
- 改路径(`rendering/scene/` → `basic/scene/`)
- 整理为"注册中心"模式(明确 ShapeRegistry / SubstanceRegistry 等接口)
- 去掉与已删除模块(GraphRenderer / adapter / projection 等)的耦合

### 1.3 注册中心接口(草案)

```ts
// src/plugins/graph/basic/registry/types.ts

interface ShapeRegistry {
  register(id: string, shape: ShapeDefinition): void;
  get(id: string): ShapeDefinition | null;
  list(): ShapeDefinition[];
}

interface SubstanceRegistry {
  register(util: SubstanceUtil): void;
  get(type: string): SubstanceUtil | null;
  list(): SubstanceUtil[];
  /** 按 domain 筛选 — variants 用,如 family-tree 查"family/person" */
  listByDomain(domain: string): SubstanceUtil[];
}

interface SubstanceUtil {
  type: string;                         // 唯一 id (e.g. 'family/person')
  domain: string;                       // 领域 (e.g. 'family')
  shapeId: string;                      // 用哪个 shape (e.g. 'rounded-rect')
  defaultProperties: Record<string, unknown>;
  /** 渲染时用属性查表得到具体视觉(颜色 / 尺寸 / 文字等) */
  computeVisual(props: Record<string, unknown>): ShapeVisual;
}
```

variants(如 family-tree)通过这套接口拿 shape + substance:

```ts
// src/plugins/graph/variants/family-tree/projection.ts
const personUtil = substanceRegistry.get('family/person');
const visual = personUtil.computeVisual(node.properties);
const shape = shapeRegistry.get(personUtil.shapeId);
const mesh = shape.createMesh(visual);
```

---

## 2. v1.5+ 愿景:macOS Freeform 风格的自由画板

**愿景声明**:BasicView 长期发展为类似 macOS Freeform / tldraw / Excalidraw 的**用户可见自由画板**,允许用户:

1. 在画板上**自由绘制 shape**(矩形 / 圆 / 自由路径 / 文字)
2. **定义 substance**(自定义语义模板,如"我的客户" substance 有 name/email/订单数 字段)
3. 这些自定义资源**可被所有 Graph variants 调用**(family-tree / knowledge / mindmap...)
4. 作为知识图谱的"工件库"

### 2.1 参考应用

| 应用 | 学什么 |
|---|---|
| **macOS Freeform** | 700+ shape 库 + Scenes(命名视口书签 → KRIG ViewMode 同构);连接器是一等公民,stay attached |
| **tldraw** | ShapeUtil + meta 模式 = KRIG Substance 概念的 web 标准实现;arrow binding 系统 |
| **FigJam** | 连接器 magnet 词汇:`TOP/LEFT/BOTTOM/RIGHT/CENTER/AUTO/NONE`(直接抄) |
| **Excalidraw** | restore.ts 数据迁移层模式;customData 字段 = Substance 定义点 |
| **Three.js Editor** | Command 模式 undo/redo;outliner UI 模式 |

### 2.2 v1.5+ 路线图(初步)

| 版本 | 内容 |
|---|---|
| **v1.0** | 注册中心架构(无 UI,代码层接口,family-tree 调用)— 本 spec v1 范围 |
| **v1.1** | 多选 + 框选 + 对齐辅助线 + 吸附 + 分组 + 撤销/重做 |
| **v1.2** | 用户可视化编辑 shape(矩形 / 圆 / 文字 / 自由路径)|
| **v1.3** | 用户定义 substance UI(类似 Notion property type 创建) |
| **v1.4** | 连接器自动路由(orthogonal / 智能避障)|
| **v1.5** | Scenes / ViewMode 书签(Freeform 2024 同款)|
| **v2.0** | shape 库 panel + 自由墨迹 + 图片导入(Freeform 级别功能)|
| **v2.x** | 协同(Yjs CRDT — tldraw 同款)|

### 2.3 关键架构决策(为 v1.5+ 预留)

下面这些决策在 v1.0 实现注册中心时**就要定下来**,免得 v1.5+ 加 UI 时返工:

#### 决策 1:数据序列化格式

```ts
type BasicViewBoard = {
  id: string;
  schema_version: number;     // 数据迁移用(参考 Excalidraw restore.ts)
  shapes: SerializedShape[];
  edges: SerializedEdge[];
  metadata: { ... };
};

type SerializedShape = {
  id: string;
  type: string;               // shape type id (e.g. 'rounded-rect')
  substance_type?: string;    // 可选,绑定的 substance (e.g. 'family/person')
  position: { x: number; y: number; z?: number };
  properties: Record<string, unknown>;
  meta?: Record<string, unknown>;   // tldraw 风:embedder app data,引擎不解析
};

type SerializedEdge = {
  id: string;
  type: string;               // edge type
  endpoints: [EdgeEndpoint, EdgeEndpoint];
  properties: Record<string, unknown>;
};

type EdgeEndpoint = {
  shapeId: string;
  magnet: 'auto' | 'center' | 'top' | 'bottom' | 'left' | 'right' | 'none';   // FigJam 词汇
};
```

v1 不直接序列化(variants 自己管),但**variant 的序列化字段名要和这个 schema 对齐**。

#### 决策 2:连接器是一等公民

不要把 edge 当作"两个 shape position 派生的几何"——edge 是独立 entity,有自己的 id / properties / endpoints。这是 Freeform / FigJam / tldraw 共同选择。

KRIG 现状:已经把 line geometry 当独立 entity(historically 是这样),延续。

#### 决策 3:Three.js + HTML overlay 文字渲染

v1 用 SVG label(KRIG 现有方案,有 fitToContent NaN 防御等踩坑经验)。

v1.5+ 切到 CSS2DRenderer 或 CSS3DRenderer,因为:
- HTML 文字渲染(retina / 中英混排 / 字体回退 / IME 输入)直接用浏览器原生
- v1.5+ 加用户可编辑文字时,HTML overlay 是必经之路
- 不阻塞 v1(SVG label 已经能用)

#### 决策 4:不混 Konva / Fabric

KRIG 已经用 Three.js,加 Konva / Fabric 会双 2D 对象模型,增加复杂度。Three.js 的 Object3D scene graph 完全够用。

#### 决策 5:坐标系 — KRIG y-up

延续 KRIG 现有 y-up 坐标(与 Three.js 一致)。ELK 等 y-down 第三方算法在 adapter 边界做翻转,这一原则在 v1 就要明确(避免之前 GraphView 实验里 y-flip 散落各处的坑)。

#### 决策 6:Substance 是"类",用户在画板"实例化"

延续 KRIG memory `project_substance_is_class`:substance 由系统/库提供,用户在画板**只能 new 实例 + 设属性**,不能改 substance 本身定义。

v1.5+ 加"用户定义 substance" UI 时,**该用户定义的 substance 也是新 substance,不是改老 substance**。这是 OOP 哲学,不要妥协。

### 2.4 BasicView 是否可独立成完整 view?

**长期是的,但不是 v1 目标**。

v2.x+ 后,BasicView 可以作为顶层 view 之一(像 NoteView 一样独立)— 用户能直接打开 BasicView 当画板用,不必通过某个 variant。但 v1 BasicView **没有独立 UI 入口**,只是 variant 的底座。

这个升级路径**自然涌现**:当注册中心 + 渲染 + 编辑 UI 都齐备后,加一个 NavSide 入口"+ 新建画板"就完成了。

---

## 3. 与现有 KRIG 模块的关系

### 3.1 与 NoteView 的关系

- **解耦**:BasicView 是 Three.js 渲染,NoteView 是 ProseMirror DOM 渲染,各自独立
- **互引**:BasicView 上的节点可以引用 noteId(`node.atom_ref = noteId`),用户点击节点 → 可在 NoteView 打开该 note(v1.5+ 实现)
- **数据共享**:语义层(note)是真理之源,BasicView 是 note 内容的一种渲染方式

### 3.2 与 v1 family-tree variant 的关系

family-tree v1 是 BasicView 的**第一个消费者**:
- family-tree 不直接用 Three.js
- family-tree 通过 BasicView 的 `shapeRegistry` 拿 `rounded-rect` 等 shape
- family-tree 通过 BasicView 的 `substanceRegistry` 拿 `family/person` 等 substance
- family-tree 自己实现 layout 算法 + 视觉规则,然后调 BasicView 接口渲染

这迫使 BasicView v1 接口**真的好用**——如果接口设计得 family-tree 不顺手,后续 variants 也不顺手。**family-tree 是 BasicView v1 的验证用例**。

### 3.3 与三层架构的关系

```
语义层 (note,知识本身)                     ← 不动
    ↓
表征层 (Graph variant 的渲染数据)            ← family-tree variant 在这层做事
    ↓ 调用 BasicView 接口
BasicView 共享底座(注册中心 + Three.js)    ← 本 spec
    ↓
View 层(实际渲染)
```

BasicView 不是单独的"层",而是表征层和 View 层之间的**共享设施**。

---

## 4. 实施分阶段(v1)

详见 `docs/graph/family-tree/family-tree.md` 的实施分阶段——family-tree variant 是 BasicView v1 的第一个消费者,两者**同步实施**(family-tree 推动 BasicView 的接口暴露)。

BasicView v1 单独的工作量:
- M1a: cherry-pick backup 分支的 Three.js 底座代码到 `src/plugins/graph/basic/`,清理与旧 GraphView 模块的耦合 — **0.5-1 天**
- M1b: 整理为 ShapeRegistry / SubstanceRegistry / LabelRegistry 接口(注册中心架构)— **0.5 天**

合计 BasicView v1: **1-1.5 天**(family-tree variant 驱动 + 验证)

---

## 5. 不做(明确 v1.5+ 留项)

| 功能 | 留待 |
|---|---|
| 用户可视化编辑 shape / substance | v1.2 / v1.3 |
| 多选 / 框选 / 对齐 / 吸附 / 分组 | v1.1 |
| 撤销 / 重做(undo/redo) | v1.1 |
| 连接器自动路由 | v1.4 |
| Scenes / ViewMode 书签 | v1.5 |
| shape 库 panel UI | v2.0 |
| 自由墨迹 / 图片导入 | v2.0 |
| 协同 / 多人编辑(Yjs CRDT) | v2.x |
| 独立 view 入口("+ 新建画板") | v2.x |
| 3D 模式(spatial knowledge graph) | v2+(Three.js 已就位,加 z 轴变换即可) |

---

## 6. 参考资料

### Freeform 风格画板
- [macOS Freeform 介绍](https://www.apple.com/newsroom/2022/12/apple-launches-freeform-a-powerful-new-app-designed-for-creative-collaboration/)
- [Freeform 连接器使用](https://macmost.com/creating-connection-lines-in-keynote-and-freeform.html)
- [Freeform 2024 更新(Scenes)](https://blog.workapes.com/latest-updates-on-apples-freeform-app-april-2025/)

### 业界参考实现
- [tldraw](https://github.com/tldraw/tldraw) — `packages/editor/src/lib/editor/shapes/ShapeUtil.ts`(ShapeUtil + meta 模式 = Substance 标准实现)
- [Excalidraw](https://github.com/excalidraw/excalidraw) — `restore.ts`(数据迁移模式),`customData` 字段
- [Three.js Editor](https://github.com/mrdoob/three.js/tree/master/editor) — Command 模式 undo/redo
- [FigJam ConnectorEndpoint API](https://developers.figma.com/docs/plugins/api/ConnectorEndpoint/) — magnet 词汇

### 相关 KRIG memory
- [project_substance_is_class.md](memory/project_substance_is_class.md) — Substance 是"类"用户操作"实例"
- [project_substance_three_layers.md](memory/project_substance_three_layers.md) — Substance 三层架构(基类/领域/个人)
- [project_substance_is_composable_prefab.md](memory/project_substance_is_composable_prefab.md) — Substance 是画板状态快照
- [project_two_atom_layers.md](memory/project_two_atom_layers.md) — 三层架构(语义/表征/View)
- [project_basic_graph_view_only.md](memory/project_basic_graph_view_only.md) — Basic Graph 是视图层不解决语义
- [feedback_variants_inherit_basic.md](memory/feedback_variants_inherit_basic.md) — 图谱变种必须继承 basic 视图元素
- [feedback_threejs_retina_setsize.md](memory/feedback_threejs_retina_setsize.md) — Three.js Retina setSize 第三参数
- [feedback_canvas_must_show_all_content.md](memory/feedback_canvas_must_show_all_content.md) — fitToContent 是底线
- [feedback_fitcontent_nan_defense.md](memory/feedback_fitcontent_nan_defense.md) — fitToContent NaN/Infinity 防御
