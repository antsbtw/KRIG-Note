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

## 1. v1 范围(走向 C — 简单可见可编辑)

**v1 = 简单但完整的画板**:
- ✅ **可见**:NavSide 有"+ 新建画板"入口,用户能直接打开 BasicView
- ✅ **可操作**:工具栏可见,能拖出 shape、选中、移动、删除
- ✅ **可编辑**:选中节点可改属性(label / color / size)
- ✅ **可持久**:画板存为 note,关闭后重开能恢复
- ✅ **简单**:**只做 family-tree 用得到的 3 种 shape**(rounded-rect / line / text-label),其他 shape 留 v1.1+ 按需扩展

**关键原则:聚焦 + 自验证**

BasicView 既是底座,**又是它自己的第一个用户**:
- 你可以打开 BasicView 自己测试(不依赖 family-tree variant)
- 接口经过 BasicView 自己验证后,再被 family-tree variant 调用
- 避免"凭空设计接口,等到 variant 用了才发现接口不合理"

**v1 不做**(留 v1.1+):
- circle / arrow / hexagon / 自由路径 / 钢笔工具(family-tree 用不上)
- 多选 / 框选 / 对齐辅助线 / 吸附 / 分组
- 撤销 / 重做(undo/redo)
- 复制 / 粘贴
- 用户在 UI 里定义新 substance(v1 substance 仍然代码硬编码)
- 连接器自动路由

### 1.1 v1 实施清单

#### A. Three.js 底座

| 模块 | 路径 | 内容 |
|---|---|---|
| SceneManager | `src/plugins/graph/basic/scene/SceneManager.ts` | scene / camera / RAF / 坐标系(KRIG y-up)/ pan / zoom |
| InteractionController | `src/plugins/graph/basic/interaction/InteractionController.ts` | 单选 / 拖动 / 删除 / 点击空白取消选中 |

#### B. Shape 库(只 3 种 — family-tree 必备)

| Shape | 路径 | 用途(family-tree) |
|---|---|---|
| RoundedRectShape | `src/plugins/graph/basic/shapes/RoundedRectShape.ts` | 人物节点(支持尺寸 + 实/虚边框 + 已故装饰) |
| LineShape | `src/plugins/graph/basic/shapes/LineShape.ts` | 配偶横线 / 父子边的所有段 |
| TextLabelShape | `src/plugins/graph/basic/shapes/TextLabelShape.ts` | 节点上的姓名 + 日期(SVG → Three.js mesh) |

不做:CircleShape / ArrowShape / HexagonShape / ConvexHullShape(family-tree 不用)

#### C. Label 系统(只 1 种布局 — family-tree 必备)

| 模块 | 路径 | 用途 |
|---|---|---|
| SvgGeometryContent | `src/plugins/graph/basic/labels/SvgGeometryContent.ts` | SVG → BufferGeometry / ShapeGeometry |
| InsideCenterLayout | `src/plugins/graph/basic/labels/InsideCenterLayout.ts` | 节点内文字布局(family-tree 用) |

不做:above-center / below-center / left-of / right-of / inside-top(family-tree 不用)

#### D. Substance 注册中心

| 模块 | 路径 | 内容 |
|---|---|---|
| SubstanceRegistry | `src/plugins/graph/basic/substance/registry.ts` | 注册接口:`register / get / list / listByDomain` |
| ShapeRegistry | `src/plugins/graph/basic/shapes/registry.ts` | shape 注册接口 |
| LabelRegistry | `src/plugins/graph/basic/labels/registry.ts` | label 布局注册 |
| 内置 substance | `src/plugins/graph/basic/substance/built-in.ts` | `family/person`(人物)+ `family-tree/spouse-line`(婚姻线)+ `family-tree/parent-edge`(父子边) |

#### E. UI 层(画板可见可编辑)

| 模块 | 路径 | 内容 |
|---|---|---|
| BasicView 主组件 | `src/plugins/graph/basic/BasicView.tsx` | 集成 SceneManager + Toolbar + Inspector |
| Toolbar | `src/plugins/graph/basic/ui/Toolbar.tsx` | 显示 3 个 shape 工具(rect / line / label),点击进入"添加模式" |
| Inspector | `src/plugins/graph/basic/ui/Inspector.tsx` | 选中节点显示属性面板(label / color / size 编辑) |
| 注册到 KRIG view 体系 | `src/plugins/graph/basic/register.ts` | 注册 Graph view 类型 + NavSide "+ 新建画板"入口 |

#### F. 序列化

| 模块 | 路径 | 内容 |
|---|---|---|
| Board 序列化 | `src/plugins/graph/basic/persist/serialize.ts` | 画板状态 → JSON(存进 note 的 block) |
| Board 反序列化 | `src/plugins/graph/basic/persist/deserialize.ts` | JSON → 画板状态(打开画板时恢复) |
| Note 类型识别 | frontmatter `view: graph` + `variant: basic`(或留空表示通用画板) | NavSide 用专属图标显示 |

**注**:序列化格式参考 [§2.3 决策 1 数据序列化格式](#决策-1数据序列化格式)。v1 实现最小子集,字段名严格对齐 v1.5+ 升级蓝图。

### 1.2 v1 验证标准(用户操作清单)

BasicView v1 完成后,**用户必须能完成以下所有操作**才算过关。这是里程碑 1 的硬验收标准:

| # | 操作 | 期望结果 |
|---|---|---|
| 1 | 在 NavSide 点击"+ 新建画板" | 创建一个空画板 note,自动打开 BasicView |
| 2 | 在工具栏点击"Rounded Rect"工具 | 工具进入"添加模式"(光标变化或工具高亮) |
| 3 | 在画布点击位置 | 在该位置创建一个 rounded-rect 节点 |
| 4 | 重复 2-3 创建 3-5 个 rounded-rect 节点 | 所有节点显示在画布上,各自位置正确 |
| 5 | 用工具栏画 line | 拖动连接两个节点,line 画出 |
| 6 | 用工具栏画 text-label | 节点上添加文字 |
| 7 | 单击某节点 | 节点高亮(选中状态),Inspector 面板显示该节点属性 |
| 8 | 在 Inspector 改 label / color / size | 节点视觉立刻更新 |
| 9 | 拖动节点 | 节点位置跟随,与之相连的 line 自动跟随 |
| 10 | 选中节点按 Delete | 节点 + 其相连的 line 一起删除 |
| 11 | 鼠标滚轮 | 画板缩放 |
| 12 | 拖动空白区域 | 画板平移 |
| 13 | 关闭画板,重新打开 | 所有节点 / line / 属性恢复(序列化生效) |
| 14 | 保存到不同 note,重新打开 | 各画板独立,不混淆 |

**只有这 14 项全部通过,才进入里程碑 2 (family-tree variant)**。

### 1.3 BasicView v1 从零构建(不带历史包袱)

**决策**:不 cherry-pick `backup/before-pg-refactor-2026-04-28` 分支的旧代码,**从零构建**。

理由:
1. **"无业务耦合"是表面判断,深层耦合躲不掉**:旧代码隐含 GraphRenderer / adapter / projection 等架构假设;旧 RenderableScene / RenderableInstance 数据结构是为 RDF-like atom 模型设计的,与注册中心架构不匹配。
2. **注册中心是新概念,旧代码不是按这个设计的**:重构现成代码的工作量经常比从零写还大(逆向理解 + 改造)。
3. **KRIG 的关键经验已在记忆,不在代码**:Retina setSize / fitToContent NaN / 画布容器始终渲染等踩坑都在记忆(详见 §6 参考资料中的 KRIG memory 列表),从零写时主动应用这些经验即可。
4. **v1 范围本来就小**:3 个 shape(rounded-rect / line / text-label)+ 1 种 label 布局(inside-center)+ 基础 SceneManager / InteractionController + 注册中心 + UI(Toolbar/Inspector/序列化)。
5. **承认前面是实验**:cherry-pick 旧代码本质上是把实验代码当生产代码使用,违反"不留技术债"原则。

实施时,**主动应用 KRIG memory 里的经验**(详见 §6 参考资料):
- Three.js setSize 第三参数(Retina)
- fitToContent 主动调用(底线)
- fitToContent NaN/Infinity 防御(SVG label 退化几何)
- canvas 容器始终渲染(不按状态切换)
- 坐标系 KRIG y-up + ELK 边界单点 y-flip

### 1.4 注册中心接口(草案)

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

#### 决策 3:Three.js + SVG 文字渲染(始终)

**v1 和长期都用 SVG label**(SVG 几何序列化为 Three.js BufferGeometry / ShapeGeometry,作为 mesh 加入场景)。

历史经验(决定不走 HTML overlay):
- KRIG 早期实验过 HTML overlay(CSS2DRenderer / CSS3DRenderer)做文字,**实测效果不好**
- 实际问题:覆盖层与 Three.js 场景的同步开销 / Retina 不一致 / 选区交互复杂 / 动画卡顿
- SVG label 路线已经过 KRIG 实战检验,有完整的踩坑经验沉淀(fitToContent NaN 防御 / 退化几何处理等)

技术细节:
- SVG 字符串 → SVGLoader(Three.js examples)→ ShapeGeometry → THREE.Mesh
- 文字效果通过 SVG 原生支持(中英混排 / emoji / 字体回退 / 多种字号)
- v1.5+ 用户编辑文字也走 SVG 输入框 + 实时重渲染(不引入 HTML 层)

详见 KRIG memory 里 SVG label 相关踩坑(§6 参考资料)。

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

**两者严格分两个里程碑实施**(详见 §4 实施分阶段):

里程碑 1 完成 BasicView **自身可见可编辑可验证**(用户能直接打开画板加 shape 改属性)。BasicView 是它**自己的第一个用户**——通过自己测试,接口已经被验证过一次。

里程碑 2 family-tree variant 是 BasicView 的**第二个消费者**:
- family-tree 不直接用 Three.js
- family-tree 通过 BasicView 的 `shapeRegistry` 拿 `rounded-rect` 等 shape
- family-tree 通过 BasicView 的 `substanceRegistry` 拿 `family/person` 等 substance
- family-tree 自己实现 layout 算法 + 视觉规则,然后调 BasicView 接口渲染

family-tree 用的是已经在里程碑 1 验证过的接口,**降低 family-tree 实施风险**。如果 family-tree 实施过程中发现 BasicView 接口缺什么,可以回里程碑 1 补,但**不能跳过验证直接进里程碑 2**。

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

## 4. 实施分阶段

**两个里程碑严格硬隔离**:里程碑 1 完成 + 用户验证通过后,才进入里程碑 2。

### 里程碑 1 — BasicView v1(~3.75 天)

只做 family-tree 用得到的工件,聚焦 + 自验证:

| 阶段 | 内容 | 时间 |
|---|---|---|
| **M1a** | 注册中心接口(ShapeRegistry / SubstanceRegistry / LabelRegistry)+ Three.js SceneManager(scene / camera / RAF / pan / zoom / 坐标系) | 0.5 天 |
| **M1b** | RoundedRectShape + ShapeRegistry 接入 | 0.25 天 |
| **M1c** | LineShape | 0.25 天 |
| **M1d** | SVG label 系统(SvgGeometryContent + InsideCenter 布局)+ LabelRegistry | 0.5 天 |
| **M1e** | InteractionController(单选 / 拖动 / 删除 / 点空白取消选中) | 0.5 天 |
| **M1f** | Inspector 属性面板(label / color / size 编辑) | 0.5 天 |
| **M1g** | NavSide "+ 新建画板"入口 + Graph view 类型注册 | 0.25 天 |
| **M1h** | 画板序列化 / 反序列化(存进 note 的 block) | 0.5 天 |
| **M1i** | Toolbar(3 个 shape 工具按钮)+ "添加模式"流程 | 0.5 天 |
| **里程碑 1 合计** | | **~3.75 天** |
| **用户验证** | 按 §1.2 的 14 项操作清单逐条测试 | 0.5 天 |

**通过验证才进入里程碑 2**。如果某项不通过,**回到 M1x 修复后重测**,**不进里程碑 2**。

### 里程碑 2 — family-tree variant(~3 天)

详见 [family-tree.md §7](../family-tree/family-tree.md)。

**总计 v1 (BasicView + family-tree): ~7.5-8 天**(包含验证暂停时间)。

实施时主动应用 KRIG memory 里的经验(详见 §6 参考资料),避免重蹈旧实验的坑。

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
