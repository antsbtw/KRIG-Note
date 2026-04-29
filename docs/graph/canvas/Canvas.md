# Canvas — 自由创作 view + Substance 创作服务

KRIG Graph 体系的**创作工具**。两个角色:
1. 作为**独立 view**:用户从 NavSide 打开 Canvas note,自由创作
2. 作为**系统级 Substance 创作服务**:其他 view 调用 Canvas API,在 right-slot 创作 substance

## 0. 核心定位

### 0.1 在 Graph 体系中

```
┌─────────────────────────────────────────────────────┐
│ Library(资源仓库)                                  │
│   Shape + Substance,全系统共享                      │
└─────────────────────────────────────────────────────┘
        ↑                            ↑
        │ 创建 Substance              │ 调用资源
        │                            │
┌──────────────────┐         ┌────────────────────────┐
│ Canvas(本 spec)  │         │ Variant 视图           │
│  独立 view       │         │  family-tree           │
│  + 创作服务      │         │  knowledge / mindmap   │
└──────────────────┘         └────────────────────────┘
```

### 0.2 Canvas 是什么

**Canvas 是一个 view + 一个服务**:

#### 角色 A:独立 view(用户主动打开)
- NavSide "+ 新建画板" → 创建一个 Canvas note → 打开 Canvas
- 用户在画板上**自由创作**:拖入 shape、移动、改属性、组合成 substance
- 画板内容存进 note(用户可以再次打开)

#### 角色 B:系统级 Substance 创作服务(其他 view 调用)
- variant view(如 family-tree)需要新 substance 时,调 Canvas API
- Canvas 在 right-slot 打开,用户创作完后回调结果给调用者
- 类似 macOS 的颜色选择器:任何 view 需要颜色就调用,不自己实现

### 0.3 Canvas 不创建 view 类型

Canvas 是 **Graph view 的 variant**(类比 family-tree 也是 Graph 的 variant):

```
KRIG views:
└── Graph
      ├── variant: canvas      ← 本 spec(自由创作)
      ├── variant: family-tree (族谱)
      ├── variant: knowledge   (后续)
      └── ...
```

Canvas variant 与 family-tree variant 平级,共享 Library 资源。

## 1. 设计原则

1. **Canvas 是创作工具,不是浏览工具** — 用户在 Canvas 里"创造内容",Library 是资源池
2. **可见 + 可操作 + 可编辑** — 用户能直接在 Canvas 上看到、操作、修改一切
3. **对齐 PowerPoint 操作模型** — 选中 / 拖动 / 编辑属性 / 组合等核心操作用户已熟悉
4. **Canvas 内容存为 note** — 不引入新存储类型,note 系统统一
5. **自洽**:Canvas 不依赖任何 variant,自己能完整运转(其他 variant 能用 Canvas)
6. **可被调用**:对外提供 API,让其他 view 把自己嵌入(创建 substance 等场景)

## 2. v1 范围

### 2.1 用户操作清单

v1 必备的 Canvas 操作(里程碑 1 验收清单):

| # | 操作 | 期望结果 |
|---|---|---|
| 1 | NavSide "+ 新建画板" | 创建 Canvas note,自动打开 |
| 2 | 浏览 Library 工具栏 | 看到 18 个内置 shape(分类:basic / arrow / flowchart / line / text)+ 5 个内置 substance(library / family) |
| 3 | 点击 shape 工具 → 画布点击位置 | 在该位置实例化一个 shape 节点 |
| 4 | 点击 substance 工具 → 画布点击位置 | 实例化一个 substance(组合 shape) |
| 5 | 单击节点 | 节点高亮(选中),Inspector 显示属性 |
| 6 | Inspector 改 fill / line / size / label | 节点视觉立刻更新 |
| 7 | 拖动节点 | 节点跟随,所连接的 line 自动跟随 |
| 8 | 选中节点按 Delete | 节点删除(连接的 line 也删除) |
| 9 | 鼠标滚轮 | 画板缩放 |
| 10 | 拖动空白区域 | 画板平移 |
| 11 | 关闭 Canvas → 重新打开 | 内容完整恢复 |
| 12 | **多选(Shift-click)** → "Combine to Substance" | 弹出命名对话框 → 创建新 substance 存进 Library |
| 13 | 选中 substance 实例 → 右键 / 工具 → "Edit Substance" | 调用 Canvas API 在 right-slot 打开,编辑该 substance 定义 |
| 14 | 创建一个 line,两端 magnet 自动吸附到附近 shape | line 端点正确连接到节点 |

完成所有 14 项才算 v1 通过。

### 2.2 v1 不做(留 v1.5+)

| 功能 | 留待 |
|---|---|
| 框选(drag-select) | v1.1 |
| 复制粘贴(Cmd+C/V) | v1.1 |
| 撤销 / 重做(Cmd+Z) | v1.1 |
| 对齐辅助线 / 吸附网格 | v1.2 |
| 分组 / 解组(超过单层 substance 嵌套) | v1.2 |
| 层级管理(置顶 / 置底 / 上一层 / 下一层) | v1.2 |
| 自由路径(钢笔工具 / 自由墨迹) | v1.3 |
| Shape gradient / pattern fill | v1.3 |
| Line sketched style / compound type | v1.3 |
| 格式刷(复制格式) | v1.4 |
| Change Shape(右键替换) | v1.4 |
| 协同 / 多人编辑(Yjs CRDT) | v2+ |

## 3. UI 设计

### 3.1 总体布局

```
┌────────────────────────────────────────────────────────────┐
│ ┌──────┐  ┌──────────────────────────────────┐  ┌──────┐  │
│ │      │  │                                  │  │      │  │
│ │ Tool │  │                                  │  │ Insp │  │
│ │ bar  │  │         Canvas (Three.js)        │  │ ector│  │
│ │      │  │                                  │  │      │  │
│ │ ...  │  │                                  │  │ ...  │  │
│ │      │  │                                  │  │      │  │
│ └──────┘  └──────────────────────────────────┘  └──────┘  │
└────────────────────────────────────────────────────────────┘
```

- **左侧 Toolbar**:Library 浏览器 + Shape/Substance 工具
- **中间 Canvas**:Three.js 画布(主要工作区)
- **右侧 Inspector**:选中节点的属性面板

### 3.2 Toolbar(左侧)

```
┌──────────────────────┐
│ Library              │
├──────────────────────┤
│ ▼ Shapes             │
│   ▶ Basic    (11)    │
│   ▶ Arrow    (3)     │
│   ▶ Flowchart (4)    │
│   ▶ Line     (3)     │
│   ▶ Text     (1)     │
├──────────────────────┤
│ ▼ Substances         │
│   ▶ Library  (2)     │
│     ◇ Text Card      │
│     ◇ Sticky Note    │
│   ▶ Family   (3)     │
│     ◇ Person         │
│     ◇ Spouse Line    │
│     ◇ Parent Link    │
│   ▶ User     (0)     │
├──────────────────────┤
│ Combine to Substance │
│ (only when multi-    │
│ selected)            │
└──────────────────────┘
```

操作:
- 点击分类 → 展开 / 收起
- 点击 shape / substance → 进入"添加模式"(光标变化)
- 在画布点击位置 → 实例化
- 多选状态下 → "Combine to Substance" 按钮亮起

### 3.3 Inspector(右侧)

参考 PowerPoint 的 Format Shape 面板,v1 简化:

```
┌──────────────────────┐
│ Format Shape         │
├──────────────────────┤
│ Tab: Shape | Text    │   (v1 只 Shape tab)
├──────────────────────┤
│ ▼ Position           │
│   X: [120]           │
│   Y: [80]            │
│   W: [160]           │
│   H: [60]            │
├──────────────────────┤
│ ▼ Fill               │
│   ○ No fill          │
│   ● Solid            │
│   Color: [■ #4A90E2] │
│   Transparency: [0%] │
├──────────────────────┤
│ ▼ Line               │
│   ○ No line          │
│   ● Solid            │
│   Color: [■ #2E5C8A] │
│   Width: [1.5 pt]    │
│   Dash: [───────  ▾] │
├──────────────────────┤
│ ▼ Arrow (line only)  │
│   Begin: [None  ▾]   │
│   End:   [Arrow ▾]   │
├──────────────────────┤
│ ▼ Substance Override │
│   (只在 substance     │
│    实例上显示)       │
│   label: [...]       │
│   gender: [M ▾]      │
│   ...                │
└──────────────────────┘
```

字段对齐 PowerPoint Format Shape(详见 [Library.md §2.1 default_style](../library/Library.md#2.1-数据格式))。

### 3.4 多选 + Combine to Substance 流程

```
1. 用户 Shift-click 选中 3 个 shape(rect + line + label)
   ↓
2. Toolbar 底部出现 "Combine to Substance" 按钮
   ↓
3. 用户点击,弹出对话框:
   ┌─────────────────────────────────┐
   │ Create Substance                │
   ├─────────────────────────────────┤
   │ Name:        [Family Person   ] │
   │ Category:    [family          ] │
   │ Description: [Person in family] │
   │                                 │
   │       [Cancel]   [Create]       │
   └─────────────────────────────────┘
   ↓
4. 点 Create → 系统:
   a. 创建 SubstanceDef JSON(详见 Library §3.1)
   b. 计算 components 的相对位置(以选中 shape 的 bounding box 中心为锚)
   c. 写入 Library(存为 ~/Library/Substances/{id} 这篇 note)
   d. 在 Toolbar 的 Substances → User 分类下显示
   e. 画布上原 3 个 shape 替换为一个 substance 实例
```

### 3.5 Edit Substance 流程

```
1. 用户选中 substance 实例,右键 → "Edit Substance"
   ↓
2. Canvas 调用自身 API 在 right-slot 打开新 Canvas
   ↓
3. right-slot Canvas 加载该 substance 的 components 作为画布内容
   (substance 的 JSON 反序列化为画布上的 shape)
   ↓
4. 用户编辑 → 保存
   ↓
5. 系统:
   a. 重新生成 SubstanceDef JSON
   b. 写入 Library(覆盖原 note)
   c. 通知所有引用该 substance 的实例自动重渲染
```

## 4. Canvas 数据模型

### 4.1 Canvas note 内容

一篇 Canvas note 的 block 内容是一段 JSON,描述画板状态:

```jsonc
{
  "schema_version": 1,
  "viewBox": { "x": 0, "y": 0, "w": 1920, "h": 1080 },   // 画布缩放/平移状态
  "instances": [                                          // 节点实例
    {
      "id": "i-001",
      "type": "shape",                  // shape | substance
      "ref": "krig.basic.roundRect",    // 引用 Library 资源
      "position": { "x": 120, "y": 80 },
      "size": { "w": 160, "h": 60 },
      "params": { "r": 0.15 },          // 用户调整的参数
      "style_overrides": {              // 覆盖默认样式
        "fill": { "color": "#a8c7e8" }
      },
      "props": {                        // substance 实例的业务属性
        "label": "贾宝玉",
        "gender": "M"
      }
    },
    {
      "id": "i-002",
      "type": "shape",
      "ref": "krig.line.elbow",
      "endpoints": [                    // line 类型有 endpoints 而非 position
        { "instance": "i-001", "magnet": "S" },     // 连到 i-001 的 South magnet
        { "instance": "i-003", "magnet": "N" }
      ],
      "style_overrides": { ... }
    }
  ]
}
```

### 4.2 frontmatter 标识

```yaml
---
title: 我的画板
view: graph
variant: canvas
---
```

NavSide 通过 `variant: canvas` 识别,用画板图标显示。

## 5. Canvas 调用 API(被其他 view 使用)

### 5.1 用例:family-tree 创建新 substance

```ts
// 在 family-tree variant 中
import { canvasAPI } from '@/plugins/graph/canvas/api';

async function createNewPersonSubstance() {
  const result = await canvasAPI.openInRightSlotForSubstanceCreation({
    title: '创建新人物 Substance',
    suggestedCategory: 'family',
    initialShapes: [],   // 可选:预填 shape
    onComplete: (substanceId) => {
      // 用户创作完成,新 substance 已存进 Library
      console.log('新 substance 创建:', substanceId);
    },
    onCancel: () => {
      console.log('用户取消');
    },
  });
}
```

### 5.2 用例:family-tree 编辑现有 substance

```ts
async function editExistingSubstance(substanceId: string) {
  await canvasAPI.openInRightSlotForSubstanceEdit({
    substanceId,
    onSave: (updatedDef) => { /* 更新已生效 */ },
    onCancel: () => { /* 用户取消 */ },
  });
}
```

### 5.3 API 设计原则

- **非阻塞**:Canvas 在 right-slot 打开,调用方不等待(用户可同时看 family-tree 和 Canvas)
- **回调通知**:通过 callback / Promise 通知调用方结果
- **状态隔离**:right-slot 的 Canvas 与主 Canvas 完全独立,不互相影响

## 6. 模块结构

```
src/plugins/graph/canvas/
├── CanvasView.tsx               # React 主组件(整合 Toolbar + Three.js + Inspector)
├── scene/
│   ├── SceneManager.ts          # Three.js scene + camera + RAF + 坐标系
│   ├── pan-zoom.ts              # 画布平移 / 缩放
│   └── render.ts                # 节点 / line 渲染管线
├── interaction/
│   ├── InteractionController.ts # 鼠标事件 / 选中 / 拖动 / 删除
│   ├── magnet-snap.ts           # line 端点吸附 magnet
│   └── add-mode.ts              # "添加模式"逻辑(点击工具后再点画布)
├── ui/
│   ├── Toolbar/
│   │   ├── Toolbar.tsx          # Library 浏览器
│   │   ├── ShapeBrowser.tsx     # Shape 分类树
│   │   ├── SubstanceBrowser.tsx # Substance 分类树
│   │   └── CombineButton.tsx    # 多选时的 "Combine to Substance"
│   ├── Inspector/
│   │   ├── Inspector.tsx        # 主 Inspector 容器
│   │   ├── PositionPanel.tsx    # X/Y/W/H 编辑
│   │   ├── FillPanel.tsx        # Fill 编辑
│   │   ├── LinePanel.tsx        # Line 编辑
│   │   ├── ArrowPanel.tsx       # Arrow 编辑
│   │   └── SubstancePropsPanel.tsx  # substance 实例的 props 编辑
│   └── dialogs/
│       └── CreateSubstanceDialog.tsx  # 命名对话框
├── persist/
│   ├── serialize.ts             # 画布状态 → JSON
│   ├── deserialize.ts           # JSON → 画布状态
│   └── note-binding.ts          # Canvas note 加载 / 保存
├── api/
│   ├── canvas-api.ts            # 公开 API(被其他 view 调用)
│   └── right-slot-mount.ts      # right-slot 挂载逻辑
├── register.ts                  # 注册为 Graph variant
└── index.ts
```

## 7. v1 实施分阶段(里程碑 1)

参考 [BasicView 已废弃 spec],按 Library 调研后的成果重新规划。

### M1.1 Library 基础(1.5-2 天)

**前置依赖**:Library 必须先建,Canvas 才能消费。

详见 [Library.md §5 模块结构](../library/Library.md#5-模块结构)。具体工作:
- M1.1a: ShapeRegistry + 18 个 shape JSON 定义文件 — **0.5-0.75 天**
- M1.1b: parametric renderer + formula evaluator(17 个操作符)— **0.5 天**
- M1.1c: SubstanceRegistry + 5 个内置 substance JSON — **0.25 天**
- M1.1d: SVG path → Three.js mesh 转换器 — **0.25-0.5 天**

### M1.2 Canvas 渲染管线(1-1.5 天)

- M1.2a: SceneManager(Three.js 底座) — **0.5 天**
- M1.2b: 节点渲染管线(从 instance JSON → mesh 渲染) — **0.5-0.75 天**
- M1.2c: Magnet 吸附(line 端点跟随 shape) — **0.25 天**

### M1.3 Canvas 交互(1 天)

- M1.3a: 单选 / 多选 / 拖动 / 删除 — **0.5 天**
- M1.3b: pan / zoom — **0.25 天**
- M1.3c: 添加模式(点击工具 → 点击画布实例化) — **0.25 天**

### M1.4 Canvas UI(1.5-2 天)

- M1.4a: Toolbar(Library 浏览器,分类显示 shape + substance) — **0.5-0.75 天**
- M1.4b: Inspector(Position/Fill/Line/Arrow 面板) — **0.75-1 天**
- M1.4c: Substance 创建对话框 + 多选 → Combine — **0.25 天**

### M1.5 序列化 + Canvas note(0.5 天)

- M1.5a: 画板 → JSON 序列化 / 反序列化 — **0.25 天**
- M1.5b: NavSide "+ 新建画板"入口 + frontmatter 校验 — **0.25 天**

### M1.6 调用 API(0.5 天)

- M1.6a: `canvasAPI.openInRightSlotForSubstanceCreation` — **0.25 天**
- M1.6b: `canvasAPI.openInRightSlotForSubstanceEdit` — **0.25 天**

### 合计

| 阶段 | 时间 |
|---|---|
| M1.1 Library 基础 | 1.5-2 天 |
| M1.2 Canvas 渲染管线 | 1-1.5 天 |
| M1.3 Canvas 交互 | 1 天 |
| M1.4 Canvas UI | 1.5-2 天 |
| M1.5 序列化 | 0.5 天 |
| M1.6 调用 API | 0.5 天 |
| **里程碑 1 合计** | **~6-7.5 天** |
| 用户验证(§2.1 14 项) | 0.5 天 |

里程碑 1 通过验证后,才进入 family-tree variant(里程碑 2,详见 [family-tree.md](../family-tree/family-tree.md))。

## 8. v1 验收标准

详见 §2.1 的 14 项操作清单。**全部通过才进入里程碑 2**。

特别强调:
- 第 12 项(Combine to Substance)是 Canvas 创作能力的核心验证
- 第 13 项(Edit Substance via API)是被其他 view 调用能力的核心验证
- 第 14 项(Magnet 吸附)是 line 与 shape 联动的核心

## 9. 与现有 KRIG 模块关系

- **Note 系统**:Canvas 内容存为 note(`view: graph` + `variant: canvas`)
- **Library**:Canvas 是 Library 的主要消费者(浏览 + 实例化 + 创建 substance)
- **NoteView**:用户能像浏览 note 一样浏览 Canvas note(切换 view 模式)
- **NavSide**:"+ 新建画板"入口,Canvas note 用专属图标
- **right-slot 协议**:被 family-tree 等 view 调用时,Canvas 在 right-slot 打开

## 10. 参考资料

### 工业参考
- [PowerPoint Format Shape Pane](https://support.microsoft.com/en-us/office/format-a-shape-or-other-graphic-effects-cf1bb2d3-cdc0-4d50-a14f-9e83fbcadb45)
- [tldraw](https://github.com/tldraw/tldraw) — 组件化 shape + 创作 UI
- [Excalidraw](https://github.com/excalidraw/excalidraw) — 极简画板交互
- [draw.io / mxGraph](https://github.com/jgraph/drawio) — Stencil + 创作工具
- [macOS Freeform](https://www.apple.com/newsroom/2022/12/apple-launches-freeform-a-powerful-new-app-designed-for-creative-collaboration/) — 现代 freeform 画板参考

### 相关 spec
- [Library.md](../library/Library.md) — Shape + Substance 资源库
- [family-tree.md](../family-tree/family-tree.md) — 第一个消费 Library 的 variant

### KRIG memory
- [feedback_threejs_retina_setsize.md](memory/feedback_threejs_retina_setsize.md) — Three.js Retina setSize 第三参数
- [feedback_canvas_must_show_all_content.md](memory/feedback_canvas_must_show_all_content.md) — fitToContent 是底线
- [feedback_canvas_container_must_always_render.md](memory/feedback_canvas_container_must_always_render.md) — canvas 容器始终渲染
- [feedback_fitcontent_nan_defense.md](memory/feedback_fitcontent_nan_defense.md) — NaN 防御
