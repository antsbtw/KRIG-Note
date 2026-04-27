# KRIG Graph Canvas Spec

> **状态**：v0.2 草稿（2026-04-27）
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

### §2.1 v1 必做（已部分实现）

| 维度 | 操作 | 现状 |
|---|---|---|
| **节点位置** | 拖拽移动 | ✅ 已实现（pinned position atom）|
| **节点视觉** | 改颜色 / 大小 / 形状 / 边框 | ⚠️ schema 已支持，UI 缺失 |
| **边视觉** | 改颜色 / 粗细 / 箭头 | ⚠️ schema 已支持，UI 缺失 |
| **图谱级参数** | 改方向（DOWN/UP/LEFT/RIGHT）/ 边样式（直角/弧/直线）/ 节点间距 | ❌ 无机制（本 spec 重点）|

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

#### B. 图谱级布局参数（subject_id = 图谱 id，新增）

```
layout.direction         布局方向（DOWN / UP / LEFT / RIGHT）
layout.edge-style        边路由样式（orthogonal / splines / polyline / straight）
layout.spacing.node      节点间距
layout.spacing.layer     层间距（仅 layered/tree 类）
```

存储约定：layout_id = 当前 layout id（如 `'tree-hierarchy'`），不跨布局（不同布局的方向语义不同）。

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

| Phase | 工作 | 用户可见效果 | 依赖 |
|---|---|---|---|
| **B4.1** | presentation atom 扩展（§3.2 A 类视觉 + B 类布局参数）+ resolver 消费 | 节点视觉 / 边视觉 / 图谱方向 等 atom 能影响渲染 | — |
| **B4.2** | 画板编辑 UI v1：节点/边右键菜单 + 图谱级属性面板 | 用户能改视觉、改方向 | B4.1 |
| **B4.3** | 凝结协议 v1：命令面板"凝结为 substance" + 写入 user 层 | 用户能保存当前画板为 substance | B4.1, B4.2 |
| **B4.4** | substance 调用：引用带 canvas_snapshot 的 substance 自动应用 | 其他图谱能复用凝结结果 | B4.3 |
| **B4.5** | substance 库浏览面板 v1：列出 user 层 substance + 删除 | 用户能管理已凝结的 substance | B4.3 |
| **B4.6** | substance 编辑模式：直接编辑已有 substance 的 canvas_snapshot | 用户能修改而非新建 | B4.5 |

### §6.1 试金石：tree 多布局问题

最初的需求："想让 tree 布局支持多种风格（方向 / 边样式 / 算法）"。

**画板模型下的解法**：
- 不需要新增 layout 算法
- 不需要新增 ViewMode
- 用户在画板上改 `layout.direction = 'DOWN'` / `layout.edge-style = 'orthogonal'` 等参数 → 凝结为"我的树状图风格" substance → 下次直接引用

**B4.1 + B4.3 完成后这个需求就被自动覆盖。** 如果发现还得写新代码，说明 §3.2 attribute 列表漏了什么，回头补。

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

本 spec 起草过程中达成的决议（用户已拍板）：

1. **画板模型**作为核心模型：自动布局是起点，编辑是核心，凝结是产物 ✅
2. **大幅精简**：删除 v0.1 的 composes / external_interface / 命名空间 / 版本族等所有"未来章节"，仅保留编辑+凝结基础闭环 ✅
3. **不引入"组合 / 继承 / 嵌套"概念** v1：留作 v1.5+ 演进 ✅
4. **canvas_snapshot 字段** 是 v1 唯一的 schema 新增 ✅
5. **跟 ViewMode 现状保持兼容**：v1 不让 ViewMode 引用 substance，等用着再说 ✅
6. **凝结自动替换原图 v1 不做**：用户手动决定哪些图谱改用新 substance ✅
7. **写入实时**：编辑操作立刻 persist atom，不要"显式保存" ✅

---

## §10 后续

### §10.1 进入实施前

1. ~~用户审 v0.2~~（本次对话已完成核心方向确认）
2. 进入 B4.1 实施
3. 每个 Phase 完成后回头核对：本 spec 是否需要补充

### §10.2 待补章节（v0.3+）

- §2 编辑维度的具体 UI 草图
- §4 凝结对话框 UI 草图
- §5 调用流程的边界情况（图谱已有 override vs substance 提供值的优先级）
- 测试样例集

---

**v0.2 起草完成。核心模型 = 画板。**
