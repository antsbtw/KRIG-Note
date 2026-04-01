# columnList + column — 多列布局

> **类型**：Container（columnList 包含 2-3 个 column）
> **位置**：文档中任意位置
> **状态**：待实现

---

## 一、定义

columnList 是多列布局容器——将内容并排显示为 2-3 列。

```
┌─────────────────┬─────────────────┐
│ 左列内容         │ 右列内容         │
│ paragraph...    │ paragraph...    │
│ image...        │ codeBlock...    │
└─────────────────┴─────────────────┘
```

---

## 二、涉及的 Block

| Block | 类型 | content | 角色 |
|-------|------|---------|------|
| `columnList` | Container | `column{2,3}` | 列容器（2 或 3 列） |
| `column` | Container | `block+` | 单列（包含任意 Block） |

---

## 三、Schema

```typescript
// columnList
nodeSpec: {
  content: 'column column column?',   // 2-3 列
  group: 'block',
  attrs: {
    columns: { default: 2 },
  },
}

// column
nodeSpec: {
  content: 'block+',
}
```

---

## 四、SlashMenu

```typescript
slashMenu: {
  label: '2 Columns',
  icon: '▥',
  group: 'layout',
  keywords: ['column', 'split', 'side', 'layout'],
  order: 0,
}
```

---

## 五、BlockDef

```typescript
export const columnListBlock: BlockDef = {
  name: 'columnList',
  group: 'block',
  nodeSpec: {
    content: 'column column column?',
    group: 'block',
    attrs: { columns: { default: 2 } },
  },
  nodeView: columnListNodeView,
  capabilities: {
    turnInto: ['paragraph'],
    canDelete: true,
    canDrag: true,
  },
  containerRule: {},
  slashMenu: {
    label: '2 Columns',
    icon: '▥',
    group: 'layout',
    keywords: ['column', 'split', 'side', 'layout'],
    order: 0,
  },
};

export const columnBlock: BlockDef = {
  name: 'column',
  group: '',
  nodeSpec: { content: 'block+' },
  capabilities: {},
  containerRule: {},
  slashMenu: null,
};
```

---

## 六、设计原则

1. **2-3 列限制** — 超过 3 列阅读体验差
2. **列是 Container** — 每列可包含任意 Block
3. **溶解为平铺** — turnInto paragraph 时列内容顺序平铺
