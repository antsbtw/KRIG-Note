# callout — 提示框

> **类型**：Container（block+ 子节点）
> **位置**：文档中任意位置
> **状态**：待实现

---

## 一、定义

callout 是带图标和背景色的提示框——用于强调、警告、提示等场景。

```
💡 这是一条提示信息
   可以包含多行内容
   甚至嵌套其他 Block
```

---

## 二、Schema

```typescript
nodeSpec: {
  content: 'block+',
  group: 'block',
  attrs: {
    emoji: { default: '💡' },
  },
}
```

### attrs 说明

- `emoji`：提示框图标，默认 💡。用户可以点击更换
- 不用 `calloutType`（NOTE/WARNING/TIP）——直接用 emoji 更灵活，不限制类型

---

## 三、Capabilities

```typescript
capabilities: {
  turnInto: ['paragraph'],    // 溶解 → 子 Block 平铺
  canDelete: true,
  canDrag: true,
}
```

---

## 四、EnterBehavior

```typescript
enterBehavior: {
  action: 'split',
  exitCondition: 'empty-enter',
}
```

---

## 五、NodeView

```
┌─ callout ────────────────────────┐
│ 💡  paragraph 内容                │
│     更多内容...                   │
│     嵌套 Block...                 │
└──────────────────────────────────┘
```

- 左侧 emoji 图标（点击可更换）
- 背景色由 emoji 隐含（或统一淡色背景）
- 内容区域包含任意 block

---

## 六、SlashMenu

```typescript
slashMenu: {
  label: 'Callout',
  icon: '💡',
  group: 'basic',
  keywords: ['callout', 'note', 'warning', 'tip', 'important', 'alert'],
  order: 11,
}
```

---

## 七、未来升级路径

### 7.1 Emoji 选择器

点击 emoji 弹出选择器，快速切换图标。

### 7.2 Tab Container 升级

callout 升级为 Tab Container（多语言提示）：
```
💡 [原文] [翻译]
    提示内容...
```

---

## 八、BlockDef

```typescript
export const calloutBlock: BlockDef = {
  name: 'callout',
  group: 'block',
  nodeSpec: {
    content: 'block+',
    group: 'block',
    attrs: { emoji: { default: '💡' } },
  },
  nodeView: calloutNodeView,
  enterBehavior: {
    action: 'split',
    exitCondition: 'empty-enter',
  },
  capabilities: {
    turnInto: ['paragraph'],
    canDelete: true,
    canDrag: true,
  },
  containerRule: {},
  slashMenu: {
    label: 'Callout',
    icon: '💡',
    group: 'basic',
    keywords: ['callout', 'note', 'warning', 'tip', 'important', 'alert'],
    order: 11,
  },
};
```

---

## 九、设计原则

1. **emoji 而非 type**——不限制提示框类型，用户自由选择图标
2. **通用 Container**——content `block+`，可包含任何 Block
3. **空行退出**——和 blockquote 一致
