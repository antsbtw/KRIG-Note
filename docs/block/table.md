# table — 表格

> **类型**：Container（table + tableRow + tableCell + tableHeader 四个 Block 协同）
> **位置**：文档中任意位置
> **状态**：待实现

---

## 一、定义

table 是表格容器——由行（tableRow）和单元格（tableCell/tableHeader）组成的二维结构。

```
┌──────────────┬──────────────┐
│ Header A     │ Header B     │  ← tableHeader
├──────────────┼──────────────┤
│ Cell 1       │ Cell 2       │  ← tableCell
├──────────────┼──────────────┤
│ Cell 3       │ Cell 4       │
└──────────────┴──────────────┘
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
  },
  tableRole: 'cell',
}

// tableHeader
nodeSpec: {
  content: 'block+',
  attrs: {
    colspan: { default: 1 },
    rowspan: { default: 1 },
  },
  tableRole: 'header_cell',
}
```

---

## 四、Capabilities

### table

```typescript
capabilities: {
  turnInto: [],               // 表格不能转为其他类型
  canDelete: true,
  canDrag: true,
}
```

### tableCell / tableHeader 专有操作

```typescript
customActions: [
  { id: 'add-row-above', label: 'Add Row Above' },
  { id: 'add-row-below', label: 'Add Row Below' },
  { id: 'add-col-left', label: 'Add Column Left' },
  { id: 'add-col-right', label: 'Add Column Right' },
  { id: 'delete-row', label: 'Delete Row' },
  { id: 'delete-col', label: 'Delete Column' },
  { id: 'merge-cells', label: 'Merge Cells' },
  { id: 'split-cell', label: 'Split Cell' },
]
```

---

## 五、SlashMenu

```typescript
slashMenu: {
  label: 'Table',
  icon: '▦',
  group: 'basic',
  keywords: ['table', 'grid', 'spreadsheet'],
  order: 12,
}
```

### 创建方式

SlashMenu 选择 Table → 创建默认 3×3 表格（1 header row + 2 data rows）。

---

## 六、技术方案

使用 `prosemirror-tables` 包——提供表格编辑的完整支持（合并/拆分单元格、列宽调整、行列增删）。

---

## 七、未来升级路径

### 7.1 列宽调整

拖拽列边界调整宽度。

### 7.2 排序

点击 tableHeader 排序该列。

### 7.3 Tab Container 升级

table 升级为 Tab Container：
```
[表格] [图表] [数据]
```

---

## 八、设计原则

1. **四个 Block 协同**——table/tableRow/tableCell/tableHeader 各自独立注册
2. **单元格是 Container**——tableCell/tableHeader 的 content 是 `block+`，可包含 paragraph、list 等
3. **prosemirror-tables**——复用成熟的表格编辑库
4. **customActions**——行列操作在右键菜单和 HandleMenu 中显示
