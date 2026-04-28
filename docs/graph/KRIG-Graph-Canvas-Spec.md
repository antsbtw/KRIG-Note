# KRIG Graph Canvas Spec

> **状态**：v0.3（2026-04-27，B4.2.a 实施完毕后修订）
> **作用域**：定义图谱画板模型 —— 自动布局是起点，用户编辑是核心，凝结为 substance 是产物
> **关联文档**：
> - [KRIG-Graph-Layout-Spec.md](./KRIG-Graph-Layout-Spec.md)（自动布局算法 / projection / presentation atom）
> - [KRIG-Graph-Pattern-Spec.md](./KRIG-Graph-Pattern-Spec.md)（Pattern + ViewMode）
> - [KRIG-Note-Vision.md](../KRIG-Note-Vision.md) §5.4（用户能创造视图模式）

---

## §1 画板模型（核心）

### §1.1 一句话

> **自动布局帮用户准备一个起始画板，用户在画板上自由编辑，满意后凝结为 substance。**

### §1.2 三步闭环

```
[1] 自动布局打底
       ↓ 给用户一个起点
[2] 用户在画板上编辑
       ↓ 改位置、改视觉、改方向、改边样式 …
[3] 满意后凝结为 substance
       ↓ 持久化为可复用的画板状态快照
```

完整闭环就这三步。

### §1.3 同构类比

| 工具 | 起始内容 | 用户做什么 | 持久化产物 |
|---|---|---|---|
| Photoshop | 一张照片 | 调色 / 裁剪 / 合成 | PSD 文件 / 预设 |
| Figma | 模板 | 调字体 / 颜色 / 布局 | 组件库 |
| **KRIG Graph** | **自动布局结果** | **调位置 / 视觉 / 方向 / 边** | **Substance（画板快照）** |

### §1.4 核心定位（澄清几件事）

1. **自动布局不是终点**，是起点。够用作起点即可，**不必追求"最好看"**。
2. **切换布局 ≠ 功能切换**，等于"重新打底"。低频操作，不需要做得很显眼。
3. **Substance = 画板状态的可复用快照**，不是抽象类、不是预制构件库的入口（这些是未来章节，v1 不展开）。
4. **编辑能力是核心，自动布局是配角**。KRIG graph 真正核心是画板编辑，不是布局算法选型。

---

## §2 编辑维度（用户能改什么）

画板上用户可编辑的维度，按"v1 必做 / v1 兜底 / v1.5+"分级：

### §2.1 v1 必做（B4.2.a 已交付大半）

| 维度 | 操作 | 现状 |
|---|---|---|
| **节点位置** | 拖拽移动 | ✅ 已实现（pinned position atom，B2 阶段）|
| **节点选中** | 单选/框选/Shift 加选/Esc 清空 | ✅ 已实现（B4.2.a 第 2 步，Figma 标准交互）|
| **图谱级参数** | 方向 / 边样式 / 节点间距 / 层间距 | ✅ 已实现（B4.2.a，Inspector "画板" Tab）|
| **节点视觉** | 改颜色 / 大小 / 形状 / 边框 | ⚠️ schema + resolver 已通（adapter/composer），UI 缺失 → B4.2.b |
| **边视觉** | 改颜色 / 粗细 / 箭头 | ⚠️ schema + resolver 已通，UI 缺失 → B4.2.b |
| **substance 替换** | 改 `substance :: [[X]]` → `[[Y]]` | ❌ 无机制 → B4.2.b |

### §2.2 v1 兜底

| 维度 | 操作 |
|---|---|
| 节点折叠 / 展开 | （v1.5+）|
| 隐藏节点 / 边 | （v1.5+）|
| 添加注释层 | （v1.5+）|

### §2.3 v1.5+ 演进

- 撤销 / 重做（v1 用浏览器原生足够）
- 多选 + 批量调整
- 对齐 / 分布工具
- 模板套用（"用 user/wenwu/my-tree-style 重新打底当前画板"）

---

## §3 编辑状态持久化

### §3.1 现有 presentation atom 已能承载大部分

[KRIG-Graph-Layout-Spec.md §1.4](./KRIG-Graph-Layout-Spec.md) 的 presentation atom 结构：

```typescript
{
  subject_id: string;     // 几何体 id（图谱级用图谱 id）
  layout_id: string;      // 'force' / 'tree-hierarchy' / '*'（跨布局通用）
  attribute: string;      // 'position.x' / 'pinned' / 'fill.color' / ...
  value: string;
}
```

**已支持的 attribute**：
- `position.x` / `position.y`（节点位置）
- `pinned`（固定不参与布局）
- `label_bbox.width` / `label_bbox.height`（label 测量结果）

### §3.2 需要扩展的 attribute（v1 新增）

为支持 §2.1 表里的 v1 必做维度，扩展两类 attribute：

#### A. 节点/边视觉覆盖（subject_id = 几何体 id）

```
fill.color           节点填充色
fill.opacity         节点填充不透明度
border.color         边框色
border.width         边框宽度
border.style         边框样式（solid/dashed/dotted）
size.width           节点宽
size.height          节点高
text.color           label 颜色
text.size            label 字号
edge.color           边色（仅 line geometry）
edge.width           边宽（仅 line geometry）
edge.arrow           箭头样式（仅 line geometry）
```

存储约定：layout_id = `'*'`（跨布局共享视觉覆盖）。

#### B. 图谱级布局参数（subject_id = 图谱 id，B4.2.a 已实现）

```
layout.direction         布局方向（DOWN / UP / LEFT / RIGHT）
layout.edge-style        边路由样式（straight / orthogonal / polyline / splines）
layout.spacing.node      节点间距
layout.spacing.layer     层间距（仅 layered/tree 类）
```

**存储约定**：layout_id = 当前 layout id（如 `'tree'`），按 §3.5 的 layout family 规则共享。
**消费**：算法在内部默认值上覆盖（用户值优先）；详见 [layout-options.ts](../../src/plugins/graph/layout/layout-options.ts) 的 `resolveLayoutOptions` 翻译表。
**写入端**：Inspector "画板" Tab（B4.2.a 实装）。

### §3.3 写入时机

**实时写入** —— 用户每次操作都立刻 persist 到 atom。
- 拖动节点松手 → 写 position.x/y
- 改颜色对话框确认 → 写 fill.color
- 改方向下拉框选择 → 写 layout.direction

**理由**：避免用户忘记保存丢工作；"撤销"通过浏览器历史 + atom 反向操作实现。

### §3.4 读取时机

布局/渲染管线在每次重算时读取 atom：
1. 几何体的 position.x/y 存在 → pinned，不参与自动布局
2. 几何体的 fill.color 等存在 → 覆盖 substance.visual 默认值
3. 图谱的 layout.direction 等存在 → 作为 layout 算法的参数传入

### §3.5 Layout 命名空间与 family（B4.2.a 引入）

**问题**：用户切换"边样式"时，KRIG 在两个底层算法之间派发：
- `straight` 边 → ELK `mrtree`（紧凑 Tidy Tree）
- `orthogonal` / `polyline` / `splines` 边 → ELK `layered`（支持边路由）

但**用户感知是同一个"层级树"**，不应该因为切边样式就丢失之前调整的方向、节点位置等。

**解决**：引入"虚拟 layout id" + "family 命名空间"。

#### §3.5.1 虚拟 layout id

新增 `tree` 作为虚拟 layout id：用户和 ViewMode 引用 `'tree'`，内部根据 `layout.edge-style` atom 派发到 `tree-hierarchy`（mrtree）或 `tree-layered`（layered）。

派发规则见 [tree-dispatch.ts](../../src/plugins/graph/layout/tree-dispatch.ts) `pickTreeLayout`：

```
'orthogonal' / 'polyline' / 'splines' → tree-layered
'straight' / 未设置                   → tree-hierarchy（默认更紧凑）
```

#### §3.5.2 Layout Family

`'tree' / 'tree-hierarchy' / 'tree-layered'` 三个 layout id **共享 atom 命名空间**（family）。

判断由 [layout-family.ts](../../src/plugins/graph/layout/layout-family.ts) 的 `isInLayoutFamily` 集中处理：

```typescript
function isInLayoutFamily(atomLayoutId: string, currentLayoutId: string | undefined): boolean {
  if (atomLayoutId === '*') return true;                   // 跨布局通用
  if (atomLayoutId === currentLayoutId) return true;       // 同 layout
  if (TREE_FAMILY.has(atomLayoutId) && TREE_FAMILY.has(currentLayoutId!)) return true;  // 家族
  return false;
}
```

**消费点**（B4.2.a 全部接入）：
- `elk-adapter.ts` 的 `readPinnedPosition` —— 决定哪些 pinned atom 进入当前布局
- `adapter/index.ts` 的 presentation 过滤 —— 决定哪些视觉覆盖被渲染消费
- `layout-options.ts` 的 `readGraphLevelLayoutOptions` —— 决定哪些图谱级参数进入算法

**作用**：
1. 用户切边样式（mrtree↔layered）时 pinned/方向/间距等调整不丢
2. 旧版本（B4.1 前）写过 `layout_id='tree-hierarchy'` 的 atom 自动向后兼容

#### §3.5.3 后端不再按 layout_id 过滤

`GRAPH_LOAD_FULL` IPC handler 加载**全部** layout 的 presentation atom（不再 `['*', activeLayout]` 过滤）—— 前端用 `isInLayoutFamily` 做精细过滤。

理由：一张图谱的 atom 量级不大（典型 < 1k 条），全 load 让 family 派发由前端统一处理更干净，避免后端写 family 规则。

---

## §4 凝结协议（编辑结果 → Substance）

### §4.1 用户视角

**触发**：用户在画板上调整满意后，命令面板 → "凝结为 Substance"

**对话框输入**：
- id（建议自动生成 `user/{author}/{name}-{timestamp}`，可改）
- label（中文友好名）
- description（可选）

**结果**：
- 一个新 substance 写入 user 层
- 提示用户 "已凝结为 [[xxx]]，可在其他图谱用 `substance :: [[xxx]]` 引用"

### §4.2 数据流

```
用户点"凝结为 substance"
  ↓
[1] 收集当前画板状态：
     - 当前 layout id
     - 所有节点位置（pinned 状态）
     - 所有节点 / 边 / 图谱级 presentation atom
  ↓
[2] 打包为 substance 内部数据：
     {
       id: 'user/wenwu/my-org-chart-20260427',
       label: '我的组织图',
       origin: 'user',
       canvas_snapshot: {
         layout_id: 'tree-hierarchy',
         layout_params: { direction: 'DOWN', edge_style: 'orthogonal', ... },
         node_overrides: [{ geometry_id: '...', attributes: { ... } }, ...],
         edge_overrides: [...],
         pinned_positions: [...],
       }
     }
  ↓
[3] 写入 user 层 substance 库
  ↓
[4] 提示用户成功
```

### §4.3 v1 不做

- ❌ 自动替换原图（破坏性，用户手动决定）
- ❌ "整图凝结" vs "选区凝结"区分（v1 只做整图）
- ❌ 智能"提取共性"（LLM 协助）
- ❌ 凝结预览图

### §4.4 Schema 扩展（types.ts）

在现有 `Substance` 上**新增一个字段**：

```typescript
export interface Substance {
  // ... 现有字段保持不变 ...

  /**
   * 画板快照：凝结自用户编辑的画板状态。
   * 仅 origin='user' 的 substance 填；built-in / base 不填（它们是手写定义）。
   */
  canvas_snapshot?: {
    layout_id: string;
    layout_params?: Record<string, string>;     // §3.2 B 类 attribute
    node_overrides?: Array<{ geometry_id: string; attributes: Record<string, string> }>;
    edge_overrides?: Array<{ geometry_id: string; attributes: Record<string, string> }>;
    pinned_positions?: Array<{ geometry_id: string; x: number; y: number }>;
  };
}
```

**仅此一项 schema 改动**。其他字段（visual / roles / pattern_layout / extends 等）保持不变。

---

## §5 调用：其他图谱使用凝结的 substance

### §5.1 引用方式

其他图谱 frontmatter / 节点 atom 写：

```yaml
substance: user/wenwu/my-org-chart-20260427
```

### §5.2 应用流程

引用一个带 `canvas_snapshot` 的 substance 时：

```
[1] 渲染管线 resolve substance → 拿到 canvas_snapshot
  ↓
[2] 自动应用：
     - layout_id 设为 snapshot.layout_id
     - 把 layout_params 写入图谱级 presentation atom（attribute B 类）
     - 把 node_overrides / edge_overrides / pinned_positions 写入对应 atom
  ↓
[3] 当前图谱呈现为 snapshot 凝结时的样子
  ↓
[4] 用户可继续编辑（每次编辑 = 该图谱独立的 atom 调整，不影响 substance 本身）
```

### §5.3 升级 / 修改

- 用户可以**编辑 substance 本身**：打开 substance 库面板 → 选中 → 进入编辑模式 → 改完保存
- 编辑 substance = 修改其 canvas_snapshot
- 其他引用了它的图谱**下次渲染时**自动应用新版本（除非该图谱已经有自己的 override，则保留 override 优先）

### §5.4 v1 不做

- ❌ 版本管理（family / forked_from）—— 用户起新名就是新 substance
- ❌ 自动提示"这个 substance 有更新版本"
- ❌ 跨图谱批量替换

---

## §6 Phase 拆分

| Phase | 工作 | 用户可见效果 | 状态 |
|---|---|---|---|
| **B4.1** | LayoutInput 加 `layoutOptions` + 算法消费图谱级参数 + adapter 提取 | atom → ELK 选项管线打通；用户写 `layout.*` atom 影响渲染（无 UI）| ✅ 已完成 |
| **B4.2.a** | Inspector 浮窗 + "画板" Tab（方向 / 边样式 / 间距）+ 节点选中机制 + 解冻 tree-layered + 虚拟 tree 派发 | 用户在画板调整图谱级参数；点节点高亮、框选、Esc 清空 | ✅ 已完成 |
| **B4.2.b** | "节点" Tab：substance 替换 + 视觉覆盖 + 多选批量动作 + 边的 hit-test | 用户编辑选中节点/边的视觉 | ✅ 已完成 |
| **B4.2.c** | "文字" Tab：label 内容 / 公式编辑 | 用户改 label 文字 | 推后 v1.5+ |
| **B4.3** | 凝结协议：节点 Tab "⬢ 凝结为 Substance" + canvas_snapshot 字段 + user_substance 表持久化 | 用户保存选区画板为 substance | ✅ 已完成 |
| **B4.4** | substance 调用：单选引用含 snapshot 的 user substance 时展开（锚点替换 + 其他项新建 pinned） | 其他节点能复用凝结结果 | ✅ 已完成 |
| **B4.5** | "库" Tab：列出 user 层 substance + 双击重命名 + 悬停删除（confirm）| 用户管理已凝结的 substance | ✅ 已完成 |
| **B4.6** | "库" Tab 展开 ▸ 显示 snapshot 详情 + 删除单个几何体（不重新凝结）| 用户精简已凝结 substance 的内容 | ✅ 已完成 |

### §6.1 试金石：tree 多布局问题

最初的需求："想让 tree 布局支持多种风格（方向 / 边样式 / 算法）"。

**画板模型下的解法**（B4.2.a 已验证）：
- ✅ 不需要新增 layout id（用户视角只有"层级树"一个，内部 `tree` 虚拟派发器根据 edge-style 选 mrtree/layered）
- ✅ 不需要新增 ViewMode
- ✅ 用户在画板上改 `layout.direction` / `layout.edge-style` → 立即生效
- ⏸ 凝结为"我的树状图风格" substance → B4.3 完成后

**结论**：本试金石 B4.2.a 阶段验证通过 —— 加 layered 算法 + 虚拟派发器 + 4 个 Inspector 控件即覆盖原始需求，**无需写新 layout 算法**。

---

## §7 长期演进（不在 v1 范围）

以下是画板模型的自然延展，**v1 不做**，等用户实际需求出现时再设计：

- **Substance 引用其他 Substance**：一个 substance 内部用另一个 substance 当零件（"组合"）
- **嵌套画板**：画板里放另一个画板（substance 作为单节点参与上层布局）
- **版本族**：同一概念多个版本（family / forked_from）
- **跨 substance 关系**：穿透封装连接内部节点
- **领域包 / 主题包**：built-in 之外的中间层
- **ViewMode 引用 substance**：ViewMode 不再硬编码 layout/projection，而是引用 substance

这些都属于 v1.5+ 之后的演进。**核心原则**：等用户在画板上的实际使用产生这些需求，再加，不预先设计。

---

## §8 与现有决议的兼容性

| 既有决议 | 本 spec 是否兼容 | 备注 |
|---|---|---|
| Pattern Spec D3：v1 不实现 extends | ✅ | 本 spec 不引入继承 / 组合 / merge，仅做"快照存读" |
| Pattern Spec roles + pattern_layout | ✅ | 本 spec 不影响 Pattern 系统，正交 |
| [project_substance_is_class.md] | ✅ | substance 仍由系统/库提供；用户凝结的 substance 进入 user 层（在库中创造，不是改既有 substance）|
| [project_substance_three_layers.md] | ✅ | 用户凝结产物自然进入第三层（个人扩展层）|
| [project_basic_graph_view_only.md] | ✅ | atom → 渲染参数的 resolve 在 D-data 适配层 |
| [project_graph_file_self_contained.md] | ✅ | 图谱文件可引用 user 层 substance |
| [feedback_canvas_must_show_all_content.md] | ✅ | 应用 canvas_snapshot 后必须 fitToContent |
| [project_b3_pattern_spec_decisions.md] | ✅ | 11 条决议本 spec 都不冲突 |

---

## §9 关键决议记录

### §9.1 v0.2 起草阶段决议（spec 定型）

1. **画板模型**作为核心模型：自动布局是起点，编辑是核心，凝结是产物 ✅
2. **大幅精简**：删除 v0.1 的 composes / external_interface / 命名空间 / 版本族等所有"未来章节"，仅保留编辑+凝结基础闭环 ✅
3. **不引入"组合 / 继承 / 嵌套"概念** v1：留作 v1.5+ 演进 ✅
4. **canvas_snapshot 字段** 是 v1 唯一的 schema 新增 ✅
5. **跟 ViewMode 现状保持兼容**：v1 不让 ViewMode 引用 substance，等用着再说 ✅
6. **凝结自动替换原图 v1 不做**：用户手动决定哪些图谱改用新 substance ✅
7. **写入实时**：编辑操作立刻 persist atom，不要"显式保存" ✅

### §9.2 B4.2.a 实施阶段决议（v0.3 补）

8. **"层级树"暴露给用户的是单一概念**，内部 mrtree/layered 算法切换对用户透明 —— 通过 `layout.edge-style` atom 自动派发（虚拟 layout id `tree`）。详见 §3.5
9. **Layout family 命名空间**：`'tree' / 'tree-hierarchy' / 'tree-layered'` 共享 atom 命名空间，切边样式时 pinned/方向/间距等不丢；同时承担 B4.1 前历史 atom 的向后兼容
10. **后端不按 layout_id 过滤 presentation atom**：`GRAPH_LOAD_FULL` 全量加载，前端用 `isInLayoutFamily` 精细过滤。理由：图谱 atom 量级小，前端统一派发更干净
11. **Inspector Tab 按"作用域"分**（画板/节点/文字），不按"功能"分。用户认知是"我在改什么"，不是"我用哪种功能"
12. **Inspector 默认展开**（首次易发现）；折叠后保留细边条作为入口；位置固定右侧绝对定位浮在画布上，不挤压画布
13. **Inspector Tab 自动跟随选中状态**（无选中→画板 Tab；有选中→节点 Tab），用户主动切换后保留选择不再覆盖
14. **画布交互对齐 Figma 标准**：左键拖空白=框选（不再平移）、空格+拖=平移、Shift/Cmd/Ctrl=加选/差选、Esc=清空。**破坏性变更**：旧"左键拖空白=平移"改为新行为，对齐专业编辑器肌肉记忆
15. **单击 vs 拖动用 3px 阈值区分**：避免单击改位置；mousedown 后位移 < 3px 视为单击，≥ 3px 才进入拖动 / 框选模式
16. **边样式 4 个选项 v1 全实现**（直线/直角/折线/曲线）：用户提出"先实现 4 个，有什么再改，都不实现怎么知道哪个更好" —— 实施成本低（ELK 已支持），先开放再裁剪比从 1 慢慢加便宜
17. **节点视觉 override 路径已通**（B4.1 前已实现）：composer.ts 的 applyPresentation 支持 fill/border/text/size/labelLayout 等所有 visual 字段。B4.2.b 只缺写入端 UI

---

## §10 实施记录

### §10.1 B4.1（图谱级 layout 参数管线，2026-04-27）

**Commit**：`7f5e2d41 feat(graph/layout): B4.1 图谱级 layout 参数管线（画板模型基础）`

**关键改动**：
- `LayoutInput` 加 `layoutOptions` 字段
- 新增 [layout-options.ts](../../src/plugins/graph/layout/layout-options.ts)：从 atom 提取 + 翻译为 ELK 选项
- `tree-hierarchy` / `force` / `grid` 三个算法消费 layoutOptions
- `elk-adapter` 移除 layout id 白名单硬编码，改用 `currentLayoutId` 显式参数
- `GraphView` 提取 layoutOptions 注入 LayoutInput

**用户可见**：无（B4.1 只搭管线，UI 在 B4.2.a）

### §10.2 B4.2.a（Inspector + 选中机制 + 多 tree 布局，2026-04-27）

**Commit 链**（5 个独立 commit）：
- `003349a6 feat: 第1步 — 解冻 tree-layered + 虚拟 tree 派发`
- `ef2468ca feat: 第2步 — 节点选中机制（Figma 标准）`
- `cfe798b5 feat: 第3步 — Inspector 浮窗框架`
- `1325ce67 feat: 第4步 — 画板 Tab 完整实装`
- `5d828db5 fix(graph/ipc): GRAPH_LOAD_FULL 加载全部 atom`

**关键文件**：
- 新增 [tree-layered.ts](../../src/plugins/graph/layout/tree-layered.ts)：layered 算法
- 新增 [tree-dispatch.ts](../../src/plugins/graph/layout/tree-dispatch.ts)：虚拟 `tree` 派发器
- 新增 [layout-family.ts](../../src/plugins/graph/layout/layout-family.ts)：`isInLayoutFamily` 工具
- 新增 [components/Inspector.tsx](../../src/plugins/graph/components/Inspector.tsx)：浮窗框架
- 新增 [components/inspector/CanvasInspectorTab.tsx](../../src/plugins/graph/components/inspector/CanvasInspectorTab.tsx)：画板 Tab
- 改 [InteractionController.ts](../../src/plugins/graph/rendering/interaction/InteractionController.ts)：4 模式 + 阈值机制 + 选中回调
- 改 [GraphRenderer.ts](../../src/plugins/graph/rendering/GraphRenderer.ts)：`setSelectedIds` / `hitTestRect`
- 改 [GraphView.tsx](../../src/plugins/graph/components/GraphView.tsx)：选中 state + 框选 overlay + Inspector 接入
- 改 [viewmode/built-in/index.ts](../../src/plugins/graph/viewmode/built-in/index.ts)："层级树" 引用虚拟 `tree`
- 改 [ipc-handlers.ts](../../src/plugins/graph/main/ipc-handlers.ts)：GRAPH_LOAD_FULL 全量加载

**用户可见**：
- 切到"层级树"：右侧 Inspector "画板" Tab 出现 4 组控件（方向 / 边样式 / 节点间距 / 层间距）
- 节点选中（点击/框选/Shift 加选/Esc 清空）+ 绿色高亮
- 画布交互对齐 Figma：左键拖空白=框选、空格+拖=平移
- 调整即写 atom 持久化，下次打开还原

### §10.3 待实施

- **B4.2.b**（节点 Tab）：substance 替换 + 视觉覆盖 + 多选批量动作 + 边的 hit-test
- **B4.3**（凝结协议）：命令面板"凝结为 substance" + canvas_snapshot 字段
- **B4.4 - B4.6**：substance 调用 / 库浏览 / 编辑模式

### §10.4 待补章节（v0.4+）

- §4 凝结对话框 UI 草图
- §5 调用流程的边界情况（图谱已有 override vs substance 提供值的优先级）
- B4.2.b 节点 Tab UI 草图
- 测试样例集

---

**v0.3：B4.2.a 实施完毕，画板模型核心闭环跑通编辑环节，凝结环节待 B4.3。**
