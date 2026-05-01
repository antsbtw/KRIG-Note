# Freeform 对齐 Backlog

M1 验收通过后,对照 macOS Freeform 整理出的体验缺口清单。**不在 M1 范围**;
这是 M2+ / v1.x 的迭代源。

记录原则:
- 用户主观测过有体感差距的项 > 社区调研项(避免大杂烩)
- 每项标:优先级(P0/P1/P2)+ 实现复杂度估算 + 阻塞性

## 总览

| 编号 | 标题 | 优先级 | 复杂度 | 关键词 |
|---|---|---|---|---|
| F-1 | 点阵网格底 | P0 | 小 | 视觉锚点 / 对齐辅助 |
| F-3 | Line 顶级化 + 三态 toggle | P0 | 中 | 直线/箭头/连接器 |
| F-5 | Shape 浮条 Fill/Stroke/Text | P0 | 中 | 单击快速,双击高级 |
| F-2 | 文本三件套 Text/Sticky/Table | P0 | 中-大 | SVG path 路径,复用 NoteView |
| F-4 | Note 引用节点 | P1 | 中 | 画板与 note 系统打通 |

**实施依赖**:
- F-3 改 toolbar 顶级 → F-2 文本三件套依赖 toolbar 已重组完
- F-2 复用 backup 分支的 SVG 路径方案 → F-5 的 Text 子菜单挂这个
- F-1 / F-3 / F-5 相互独立,可并行

**核心差异化**(不只是抄 Freeform):
- F-2 文本节点 = SVG path 序列化 + ProseMirror 编辑,**碾压 Freeform 文本能力**
- F-4 Note 引用 = 画板嵌入 note,**画板成为 note 的视图**(KRIG 核心抽象)
- 不做 Freeform 的 `📎` 附件、Scenes 场景书签等(F-4 已替代附件;Scenes 是 P2 边缘)

## 视觉 / 画板底

### F-1 点阵网格底(P0,小)
- 现状:画板纯黑背景,无视觉锚点
- Freeform:浅灰小点阵(间距约 24px),提供视觉对齐参考
- 实现:SceneManager 加一层 InstancedMesh 或 shader plane,zoom 时密度自适应
  (zoom 太小时点会糊在一起 → 切换到稀疏版)
- 价值:对齐辅助 + 减少"空旷无定位"感

## 交互

(待补)

## 工具栏 / Toolbar

### F-4 Note 引用节点(P1,中)
- 不做 Freeform 的 `📎` 附件按钮 — KRIG 用 note 管资产,画板自造附件存储
  会让数据分散
- 改为画板可插入"note 引用节点":显示被引 note 的标题 + 缩略 / 摘要,
  双击跳到该 note 查看完整内容(含 note 内的附件)
- 类似 Notion 的 "page mention" 或 Obsidian 的 "embed note"
- Toolbar 入口可以与 [A] / [≡] / [#] 同级,记号 `[📄] Note Ref`,
  也可以放在 Picker 的特殊类目
- 价值:画板与 note 系统打通,体现 KRIG 的"知识图谱视角是对 note 的呈现"
  核心理念

### F-3 Line 提到 toolbar 顶级 + 三态 toggle 设计(P0,中)
- 现状:line 埋在 Picker 的 Line 类目下(3 种:straight / elbow / curved),
  入口太深
- **对齐 Freeform 三态 toggle**:toolbar 上是一个胶囊容器,容器内 3 个 icon:
  ```
  [ /  ↗  ↪ ]
   直线 箭头 连接器
  ```
  当前激活态用蓝色高亮。点 toolbar 这个胶囊先选 line 模式,再去画布画
- **三态语义**:
  - **`/` 直线**(Plain Line):两端任意,无箭头。用于画分隔 / 批注 / 划重点
  - **`↗` 箭头**(Arrow):两端任意,但默认起点无 arrow / 终点 arrow。
    强调方向性,不绑 shape
  - **`↪` 连接器**(Connector):两端必须吸附 shape magnet(= M1.x.7 当前实现)。
    强调"连接"语义
- **关键区分:自由线只需直线,connector 才需要 elbow/curved**
  - 自由线(plain / arrow):用户自己控制起终点,要绕路自己拖鼠标 →
    **路径只用直线**,不需要 elbow / curved
  - connector:两端绑 magnet 自动算路径,绕开 shape 时需要 elbow,
    或表达"柔性连接"用 curved → **必须三种路径可选**
- **每态选中后 toolbar 浮 sub-popover**(对应 Freeform 的 4 张截图):
  - 直线选中 → Stroke Style:线型 4 种(实/短虚/点/长虚)+ 线宽 + 颜色
  - 箭头选中 → Line Ends:起点 / 终点的箭头形状(各一个下拉,
    支持 none / arrow / triangle / diamond / oval / stealth — 已在
    `LineStyle.arrow` 接口里有)
  - **连接器选中** → Connection Style:3 种路径形状(直 / 阶梯 / 曲线
    = straight / elbow / curved)— **仅这一态有这个选项**
- **统一数据模型**:line 实例加两个属性,取代当前的 `ref` 区分:
  - `lineKind: 'plain' | 'arrow' | 'connector'`
  - `pathStyle: 'straight' | 'elbow' | 'curved'` — **仅当 lineKind='connector' 时有效**
  - 配合 `style_overrides.arrow.{begin, end}`(已有)调端头
  - `endpoints` 字段仅 connector 用;plain / arrow 用 position + size
- 复杂度:中。需要:
  - toolbar 三态胶囊组件(对齐 Freeform UI)
  - 每态 sub-popover(可复用现有 FloatingInspector 模式)
  - plain / arrow 走 mousedown-drag-mouseup 自由路径(不绑 magnet)
  - connector 沿用 M1.x.7 press-drag-release 模式
  - 统一 `LineRenderer.renderLine` 接受 lineKind + pathStyle
- 价值:**最高频的画板原子,入口必须顶级**;Freeform 的三态设计极简,
  我们直接照搬

### F-2 文本节点三件套:Text / Sticky / Table(P0,中-大)
- Freeform toolbar 上有三件:`[A]` 文字框(透明)、`[≡]` 便签(不透明背景文本块)、
  `[#]` 表格(透明)。每件都是"可放置在画布的文本容器"
- Freeform 的硬伤:**文本表达力弱**(无公式、无富格式、无链接)
- KRIG 的优势:**NoteView 是 ProseMirror 富文本编辑器**,已支持公式、链接、
  TOC、任意 block;直接复用即可碾压 Freeform
- 实现方向:画布上添加一个"文本节点",其内容编辑走嵌入式 NoteView 子树
  (不是新写一个简陋编辑器);三个变种区分:
  - Text:无背景 + 无边框,纯文字
  - Sticky:浅黄背景 + 圆角(类便签),有边框
  - Table:复用 ProseMirror table 节点
- **参考实现 — 两代方案对比**:
  - **v1**(`feature/graph-labels` 分支):CSS2DRenderer + 内嵌 ProseMirror DOM。
    优点:富文本能力直接复用;缺点:文字与 shape 布局不在同一坐标系,
    zoom / 对齐困难(已废弃)
  - **v2**(`backup/before-pg-refactor-2026-04-28` 分支):**SVG 路径**。
    `Atom[] → atomsToSvg(opentype.js)→ SVG <path> → Three.js SVGLoader
    → ShapeGeometry → Mesh`。文字成为真正的 Three.js geometry,
    与 shape 共享渲染管线,zoom 矢量完美;**这是正解**
  - 关键文件(v2):
    - `src/lib/atom-serializers/svg/blocks/textBlock.ts` —
      PM textBlock → SVG <path>
    - `src/lib/atom-serializers/svg/text-to-path.ts` — opentype.js
      字体 outline 化 + 字符级中英 / 字重 / italic 字体切换
    - `src/lib/atom-serializers/svg/blocks/mathInline.ts` /
      `mathBlock.ts` — 数学公式 SVG 序列化
    - `src/plugins/graph/rendering/contents/SvgGeometryContent.ts` —
      消费方:SVGLoader 解析 + 三级缓存(SVG 字符串 → ShapeGeometry +
      Material 共享)
    - `src/plugins/graph/rendering/labels/*` — 6 种 label 布局策略
      (inside-center / above / below / left / right / inside-top)
- **编辑 / 展示双模式**:
  - 展示态:SVG → Three mesh(不可交互,只渲染)
  - 编辑态:用户双击 → 浮一个 ProseMirror DOM 编辑器在 mesh 上方,
    blur 时把 doc 重新序列化为 SVG 替换 mesh
  - 类似 PowerPoint / Keynote 的"文字框双击进入编辑"模式
- **三级缓存**(性能):L1 atoms→SVG / L2 SVG→Geometry+Material / L3 mesh 每次新建
- **浮动 toolbar 风格**:对齐 Freeform 的"轻量图标条"(B / 对齐 / 列表 /
  字号 / 颜色),**但能力扩展到 NoteView 全部 inline marks**(公式 / 链接 /
  代码 等)。toolbar 跟随当前选区浮在节点上方,blur 即消失
- 复杂度:中-大,涉及"画板节点宿主一个 ProseMirror 实例"的架构问题
  (focus 切换、selection 隔离、序列化路径打通)
- 价值:**这是 KRIG vs Freeform 的核心差异化卖点**

(其他 toolbar 项待补)

## Inspector / 属性面板

### F-5 Shape 选中浮条:Fill / Stroke / Text 三图标(P0,中)
- Freeform 设计:shape 选中后,**节点下方浮一个胶囊容器**,内含 3 个图标:
  ```
  [ ●  /  Aa ]
   Fill Stroke Text
  ```
  点任一图标 → 浮 sub-popover 改对应属性,与 line 三态完全同款交互
- **Stroke sub-popover**(截图):
  - 5 种笔触:⊘ 无 / ─ 实线 / 短虚 / 点线 / 长虚
  - 粗细数字调节(3 pt)
  - 颜色块 + 调色盘按钮
- **Fill / Text** 同理(待对照截图细化)
- **vs 当前 KRIG 的 FloatingInspector**:
  | | Freeform 浮条 | 当前 FloatingInspector |
  |---|---|---|
  | 默认 | 节点下 3 图标,紧凑 | 右侧浮层,全套属性铺开 |
  | 改属性 | 点图标 → sub-popover | 面板上直接改 |
  | 优势 | 不挡画板,聚焦当前操作 | 一目了然 |
  | 劣势 | 改多属性要多次点 | 占屏幕,遮挡视图 |
- **建议混合模式**(KRIG 独有):
  - **单击节点** → 节点下方浮"快速浮条"(Freeform 风格,3 图标 sub-popover)
  - **双击节点** → 当前的 FloatingInspector(高级模式,所有属性 + 数学坐标 X/Y/W/H)
  - 用户高频操作走快速浮条;需要精确数值或一次改多属性时双击进高级
- 复杂度:中。需要:
  - 新建 ShapeQuickBar 组件(浮在节点下方,跟随节点位置 / zoom)
  - 3 个 sub-popover(Fill / Stroke / Text)— Stroke 可借鉴 line 的 Style popover
  - Text 子菜单:对接 F-2 文本节点的 inline 编辑入口

## 选中态 / Handles

(待补)

## 其他

(待补)

---

## 优先级图例

- **P0**:核心体验断点,M1 验收不影响但下一阶段必修
- **P1**:有则更好,可放 v1.1
- **P2**:nice-to-have,v1.5+

## 复杂度图例

- **小**:1 文件 / <100 行
- **中**:跨文件 / 100-300 行
- **大**:涉及架构调整 / 300+ 行
