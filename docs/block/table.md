# table — 表格

> **类型**：ContainerBlock（见 `base/container-block.md`）
> **位置**：文档中任意位置
> **状态**：基础结构已实现，UI 交互待完善

---

## 一、定义

table 是表格容器——由行（tableRow）和单元格（tableCell/tableHeader）组成的二维结构。

```
        列指示器          列指示器           +col
     ┌──────────────┬──────────────┐    ┌───┐
行   │ Header A     │ Header B     │    │ + │
指   ├──────────────┼──────────────┤    └───┘
示   │ Cell 1       │ Cell 2       │
器   ├──────────────┼──────────────┤
     │ Cell 3       │ Cell 4       │
     └──────────────┴──────────────┘
                  ┌────────────────┐
                  │       +        │  ← +row
                  └────────────────┘
```

---

## 二、涉及的 Block 类型

| Block | 类型 | content | 角色 |
|-------|------|---------|------|
| `table` | Container | `tableRow+` | 表格容器 |
| `tableRow` | Container | `(tableCell \| tableHeader)+` | 表格行 |
| `tableCell` | Container | `block+` | 普通单元格 |
| `tableHeader` | Container | `block+` | 表头单元格 |

---

## 三、Schema

```typescript
// table
nodeSpec: {
  content: 'tableRow+',
  group: 'block',
  tableRole: 'table',
  isolating: true,
}

// tableRow
nodeSpec: {
  content: '(tableCell | tableHeader)+',
  tableRole: 'row',
}

// tableCell
nodeSpec: {
  content: 'block+',
  attrs: {
    colspan: { default: 1 },
    rowspan: { default: 1 },
    colwidth: { default: null },    // 列宽（像素数组），用于列宽拖拽
  },
  tableRole: 'cell',
  isolating: true,
}

// tableHeader
nodeSpec: {
  content: 'block+',
  attrs: {
    colspan: { default: 1 },
    rowspan: { default: 1 },
    colwidth: { default: null },
  },
  tableRole: 'header_cell',
  isolating: true,
}
```

**colwidth 说明**：`colwidth` 属性由 `prosemirror-tables` 的 `columnResizing` 插件管理，存储为数字数组（每列一个像素值）。HTML 中通过 `data-colwidth` 属性持久化，渲染时同步到 `<colgroup>` 的 `<col>` 元素。

---

## 四、Capabilities

```typescript
capabilities: {
  turnInto: [],               // 表格不能转为其他类型（不支持溶解）
  marks: [],                  // marks 由单元格内的子 Block 自行处理
  canIndent: false,           // 表格不支持缩进嵌套
  canDuplicate: true,         // 整表复制
  canDelete: true,
  canDrag: true,
}
```

---

## 五、Container 规则

### 5.1 table 自身

```typescript
containerRule: {
  requiredFirstChildType: 'tableRow',  // content: 'tableRow+' 约束
}
```

table 的子节点只能是 `tableRow`，由 Schema 的 content 表达式 `tableRow+` 强约束。这与 toggleList/callout 等 `content: 'block+'` 的 Container 不同——table 的子节点类型是严格限定的。

### 5.2 tableCell / tableHeader

```typescript
containerRule: {
  requiredFirstChildType: null,   // 单元格无必填首子节点
}
```

单元格的 content 是 `block+`，可包含任意 Block。

---

## 六、键盘交互

### 6.1 Enter

| 场景 | 行为 |
|------|------|
| 单元格内 TextBlock 有内容 | 在单元格内分裂 TextBlock（不退出单元格） |
| 单元格内 TextBlock 空行 | 在单元格内创建新空行（不退出单元格） |

**与其他 Container 的关键区别**：table 的单元格是 `isolating: true`，Enter 永远不会退出单元格或表格。用户不能通过空行 Enter 退出表格——这符合表格的二维网格性质，退出表格应通过在表格外点击或使用方向键离开。

### 6.2 Tab / Shift+Tab

| 操作 | 行为 |
|------|------|
| `Tab` | 跳到下一个单元格；若在最后一个单元格则自动新增一行 |
| `Shift-Tab` | 跳到上一个单元格 |

**与其他 Container 的关键区别**：Tab 在表格中用于**单元格间导航**，而非嵌套/提升。这是因为 table 的 `canIndent: false`，表格不参与缩进嵌套体系。

### 6.3 Backspace（行首）

| 场景 | 行为 |
|------|------|
| 单元格内首个 block 行首 | 无操作（`isolating: true` 阻止跨单元格合并） |
| 单元格内非首 block 行首 | 与上一个 block 合并（在单元格内部） |

---

## 七、不变量适用性

### 7.1 不变量 9（缩进即包含）的例外

> 容器的"包含关系"以视觉缩进为准 —— CLAUDE.md §二.9

table 是不变量 9 的**例外**。table 的子节点组织方式是**二维网格**，而非视觉缩进：

- 行（tableRow）是水平排列的单元格集合
- 列是跨行的垂直对齐关系
- 包含关系由 Schema 的 content 表达式严格约束（`table > tableRow > tableCell/tableHeader`），而非缩进层级

因此 table 不参与缩进嵌套体系（`canIndent: false`），Tab/Shift-Tab 用于单元格导航而非缩进操作。

### 7.2 其他不变量

| 不变量 | 适用情况 |
|--------|----------|
| 1. Block 能力不丢失 | ✅ 单元格 content 是 `block+`，任何 Block 放入单元格后能力完全保留 |
| 2. Container 能力不丢失 | ✅ table 放入其他 Container 中，所有操作保留 |
| 3. 整体移动 | ✅ `canDrag: true`，拖拽时表格 + 全部行列单元格一起移动 |
| 4. 内容合法性 | ✅ 四层 content 表达式严格约束 |
| 5. 位置安全 | ✅ 单元格无必填首子，插入位置无限制 |
| 6. 格式化不变量 | ✅ 表格不参与格式化命令 |
| 9. 缩进即包含 | ❌ 不适用（见 7.1） |

---

## 八、操作

### 8.1 行列增删（prosemirror-tables 内置）

| 操作 | 函数 | 触发方式 |
|------|------|----------|
| 上方插入行 | `addRowBefore()` | 行指示器上下文菜单 |
| 下方插入行 | `addRowAfter()` | 行指示器上下文菜单 / +row 按钮 |
| 左侧插入列 | `addColumnBefore()` | 列指示器上下文菜单 |
| 右侧插入列 | `addColumnAfter()` | 列指示器上下文菜单 / +col 按钮 |
| 删除当前行 | `deleteRow()` | 行指示器上下文菜单（红色危险操作） |
| 删除当前列 | `deleteColumn()` | 列指示器上下文菜单（红色危险操作） |

### 8.2 复制操作（自定义命令）

| 操作 | 函数 | 说明 |
|------|------|------|
| 复制行 | `duplicateRow` | 复制光标所在行，插入到下方 |
| 复制列 | `duplicateColumn` | 复制光标所在列，插入到右侧（从下到上处理以保持位置映射正确） |
| 复制选中区域 | `duplicateSelectedCells` | 复制 CellSelection 矩形区域，作为新行插入到选区下方（非选中列用空单元格填充） |

### 8.3 列宽调整

使用 `prosemirror-tables` 的 `columnResizing` 插件：

```typescript
columnResizing({ cellMinWidth: 80, View: null })
```

- 鼠标悬停在列边界时显示拖拽手柄
- 拖拽调整列宽，最小宽度 80px
- 列宽信息通过 `colwidth` 属性持久化
- 渲染时由 `updateColumnsOnResize()` 同步 `<colgroup>`

---

## 九、视图（NodeView）

Table 使用自定义 NodeView 渲染，结构如下：

```
div.table-block-wrapper               ← 外层容器（dom）
├── div.table-col-indicators           ← 列指示器区域
│   └── div.table-col-indicator × N    ← 每列一个指示器
├── div.table-row-indicators           ← 行指示器区域
│   └── div.table-row-indicator × N    ← 每行一个指示器
├── div.table-block__scroll            ← 水平滚动容器
│   └── table.pm-table                 ← 表格元素
│       ├── colgroup                   ← 列宽定义（columnResizing 管理）
│       └── tbody ← contentDOM         ← ProseMirror 管理的内容区
├── button.table-block__add-col-btn    ← +列 按钮（右侧）
└── button.table-block__add-row-btn    ← +行 按钮（底部）
```

符合 ContainerBlock NodeView 契约：提供 `dom`（外层容器）+ `contentDOM`（tbody，ProseMirror 在其中渲染 tableRow）。

### 9.1 列指示器

- 位于表格顶部，每列一个
- 宽度和位置与下方单元格对齐（通过 `requestAnimationFrame` 同步）
- **点击行为**：先将光标定位到该列首个单元格，再弹出上下文菜单
- **菜单项**：← 插入列 / → 插入列 / ⧉ 复制列 / 删除列

### 9.2 行指示器

- 位于表格左侧，每行一个
- 高度和位置与对应行对齐
- **点击行为**：先将光标定位到该行首个单元格，再弹出上下文菜单
- **菜单项**：↑ 插入行 / ↓ 插入行 / ⧉ 复制行 / 删除行

### 9.3 +行/+列 按钮

- **+列**：表格右侧，点击后选中首行最后一个单元格，执行 `addColumnAfter`
- **+行**：表格底部，点击后选中最后一行首个单元格，执行 `addRowAfter`
- Hover 时显示

### 9.4 上下文菜单

独立的 DOM 菜单（非 React 组件），特点：
- 定位在触发元素旁边（列指示器 → 下方，行指示器 → 右侧）
- `contenteditable="false"` 防止编辑器干扰
- 外部点击自动关闭
- 危险操作（删除）用红色文字标识

### 9.5 NodeView 更新策略

- `update()`：节点类型不变时返回 true 接管更新
  - 调用 `updateColumnsOnResize()` 同步列宽
  - 延迟 30ms 重建指示器（等 DOM 更新完成）
- `ignoreMutation()`：忽略 tbody 外部的 DOM 变化（指示器、按钮等）

---

## 十、插件注册

```typescript
// 需要注册两个 prosemirror-tables 插件 + 一个键盘映射
plugins: [
  columnResizing({ cellMinWidth: 80, View: null }),  // 列宽拖拽
  tableEditing(),                                     // 单元格选择和导航
  tableKeymapPlugin(),                                // Tab / Shift-Tab
]

nodeViews: {
  table: tableNodeView,
}
```

---

## 十一、SlashMenu

```typescript
slashMenu: {
  label: 'Table',
  icon: '▦',
  group: 'basic',
  keywords: ['table', 'grid', '表格'],
  order: 12,
}
```

### 创建方式

SlashMenu 选择 Table → 创建默认 3×3 表格（1 header row + 2 data rows）。

`insertTable(rows, cols)` 命令：
- 第一行使用 `tableHeader`，其余行使用 `tableCell`
- 每个单元格默认包含一个空 `paragraph`
- 插入后光标定位到第一个 header cell 内

---

## 十二、Atom 存储

### 12.1 Atom 类型

```typescript
// 四种 Atom 类型，通过 parentId 建立层级关系
type: 'table'       → parentId: doc/container
type: 'tableRow'    → parentId: table
type: 'tableCell'   → parentId: tableRow
type: 'tableHeader' → parentId: tableRow
```

### 12.2 Content 结构

table 的 Atom 存储采用 **parentId 层级关系**，与 Schema 的 content 表达式对应：

```typescript
interface TableAtomContent {
  colCount: number;   // 列数（从首行推断）
}

interface TableCellAtomContent {
  colspan?: number;
  rowspan?: number;
  isHeader?: boolean;         // tableHeader 为 true
  // 单元格的子 Block 通过 parentId 关联，不内嵌在 content 中
  // 即：单元格内的 paragraph、list 等子 Block 各自是独立 Atom，parentId 指向此 cell Atom
}
```

**注意**：单元格的 Schema 是 `content: 'block+'`，子节点是 Block 级别。因此单元格内的子 Block 通过独立的 Atom + parentId 层级关系组织，而非 `children: InlineElement[]` 内嵌。这与 TextBlock 的 `children: InlineElement[]`（inline 流）是不同的存储模式。

---

## 十三、技术方案

核心依赖 `prosemirror-tables` 包，提供：

| 功能 | 来源 |
|------|------|
| 单元格选择（CellSelection） | `tableEditing()` 插件 |
| 行列增删 | `addRow*` / `addColumn*` / `deleteRow` / `deleteColumn` 命令 |
| 列宽拖拽 | `columnResizing()` 插件 + `updateColumnsOnResize()` |
| 单元格间导航 | `goToNextCell()` |
| 选区矩形计算 | `selectedRect()` + `TableMap` |
| 合并/拆分单元格 | `mergeCells()` / `splitCell()` （底层支持，UI 待接入） |

自定义命令：
- `insertTable(rows, cols)` — 创建表格
- `duplicateRow` / `duplicateColumn` / `duplicateSelectedCells` — 复制操作

---

## 十四、BlockDef

```typescript
export const tableBlock: BlockDef = {
  name: 'table',
  group: 'block',
  nodeSpec: {
    content: 'tableRow+',
    group: 'block',
    tableRole: 'table',
    isolating: true,
  },
  nodeView: tableNodeView,
  plugin: () => tableEditing(),
  capabilities: {
    turnInto: [],
    canIndent: false,
    canDuplicate: true,
    canDelete: true,
    canDrag: true,
  },
  containerRule: { requiredFirstChildType: 'tableRow' },
  slashMenu: {
    label: 'Table',
    icon: '▦',
    group: 'basic',
    keywords: ['table', 'grid', '表格'],
    order: 12,
  },
};

export const tableRowBlock: BlockDef = {
  name: 'tableRow',
  group: '',
  nodeSpec: { content: '(tableCell | tableHeader)+', tableRole: 'row' },
  capabilities: {},
  slashMenu: null,
};

export const tableCellBlock: BlockDef = {
  name: 'tableCell',
  group: '',
  nodeSpec: {
    content: 'block+',
    attrs: { colspan: { default: 1 }, rowspan: { default: 1 }, colwidth: { default: null } },
    tableRole: 'cell',
    isolating: true,
  },
  capabilities: {},
  containerRule: { requiredFirstChildType: null },
  slashMenu: null,
};

export const tableHeaderBlock: BlockDef = {
  name: 'tableHeader',
  group: '',
  nodeSpec: {
    content: 'block+',
    attrs: { colspan: { default: 1 }, rowspan: { default: 1 }, colwidth: { default: null } },
    tableRole: 'header_cell',
    isolating: true,
  },
  capabilities: {},
  containerRule: { requiredFirstChildType: null },
  slashMenu: null,
};
```

---

## 十五、设计原则

1. **四个 Block 协同**——table/tableRow/tableCell/tableHeader 各自独立注册
2. **单元格是 Container**——tableCell/tableHeader 的 content 是 `block+`，可包含 paragraph、list 等任意 Block
3. **prosemirror-tables**——复用成熟的表格编辑库，不重复造轮子
4. **isolating 隔离**——table 和 cell 都是 `isolating: true`，键盘操作不会意外跨越表格边界
5. **指示器 + 上下文菜单**——行列操作通过可视化指示器触发，而非隐藏在右键菜单中
6. **渐进式显示**——+行/+列按钮 hover 时显示，不占用常态视觉空间
7. **二维网格例外**——table 不参与缩进嵌套体系（不变量 9 例外），Tab 用于单元格导航

---

## 十六、未来升级路径

### 16.1 合并/拆分单元格 UI

prosemirror-tables 已提供 `mergeCells()` / `splitCell()` 命令。需要：
- 在 CellSelection 存在时，上下文菜单中显示"合并单元格"
- 在合并后的单元格上显示"拆分单元格"

### 16.2 排序

点击 tableHeader 排序该列。

### 16.3 Tab Container 升级

table 作为 ContainerBlock，天然支持升级为多 Tab 形态（见 `base/container-block.md` §十）。但 table 的 content 表达式是 `tableRow+` 而非 `block+`，升级时需要将 content 扩展为 `tabPane+ tableRow*` 或定义 table 专属的 Tab 布局方案。

```
单一视图：                    升级为多 Tab：
table                        table
  └── tableRow × N             Tab栏: [表格] [图表] [数据]
                               ├── tabPane[表格]
                               │     └── tableRow × N
                               └── tabPane[图表]
                                     └── (chart renderer)
```
