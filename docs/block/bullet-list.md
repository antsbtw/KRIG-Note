# bulletList — 无序列表

> **类型**：Container（包含 listItem 子节点）
> **位置**：文档中任意位置
> **状态**：待实现

---

## 一、定义

bulletList 是无序列表容器，用圆点标记并列的内容要点。内部包含多个 listItem。

```
• 要点 A
• 要点 B
  • 子要点 B1      ← 嵌套的 bulletList
  • 子要点 B2
• 要点 C
```

---

## 二、Schema

```typescript
nodeSpec: {
  content: 'listItem+',
  group: 'block',
  parseDOM: [{ tag: 'ul' }],
  toDOM() { return ['ul', 0]; },
}
```

无额外 attrs。

---

## 三、Capabilities

```typescript
capabilities: {
  turnInto: ['paragraph'],       // 溶解 → 每个 listItem 首子成为独立 paragraph
  marks: [],                      // 列表容器不接受 Mark
  canDuplicate: true,
  canDelete: true,
  canDrag: true,
}
```

---

## 四、Container 规则

```typescript
containerRule: {
  requiredFirstChildType: undefined,  // listItem 自身约束首子
}
```

---

## 五、SlashMenu

```typescript
slashMenu: {
  label: 'Bullet List',
  icon: '•',
  group: 'basic',
  keywords: ['list', 'bullet', 'ul', 'unordered'],
  order: 5,
}
```

---

## 六、交互行为

### 6.1 创建

- SlashMenu 选择 "Bullet List"
- Markdown 快捷输入：`- ` 或 `* ` + 空格
- 快捷键：待定

### 6.2 溶解（turnInto paragraph）

溶解时，每个 listItem 的首子 paragraph 成为独立的 paragraph：

```
溶解前：                溶解后：
• Item A               Item A
• Item B               Item B
  • Sub B1             Sub B1（嵌套被展平）
• Item C               Item C
```

### 6.3 与 orderedList 互转

bulletList ↔ orderedList 直接互转，保留所有 listItem 内容和嵌套结构：

```
• Item A       →      1. Item A
• Item B       →      2. Item B
  • Sub        →        a. Sub
```

---

## 七、视觉规格

### 标记样式（按嵌套层级循环）

| 层级 | 标记 | CSS |
|------|------|-----|
| 第 1 级 | • 实心圆 | `list-style-type: disc` |
| 第 2 级 | ◦ 空心圆 | `list-style-type: circle` |
| 第 3 级 | ▪ 实心方 | `list-style-type: square` |
| 第 4 级+ | 循环回 disc | |

### 间距

- 列表与前后 Block：0.5em
- 嵌套缩进：每级 24px

---

## 八、嵌套规则

bulletList 的 listItem 内可以包含：

| 内容类型 | 允许 | 示例 |
|---------|------|------|
| paragraph | ✅（必填首子） | 列表项文本 |
| bulletList | ✅ | 子无序列表 |
| orderedList | ✅ | 子有序列表 |
| codeBlock | ✅ | 列表项内的代码 |
| blockquote | ✅ | 列表项内的引用 |
| image | ✅ | 列表项内的图片 |
| heading | ✅ | 列表项内的标题（罕见但允许） |
| table | ✅ | 列表项内的表格（罕见但允许） |

规则：listItem 的 content 是 `paragraph block*`，任何属于 `block` 组的节点都可以出现。

---

## 九、未来升级路径

### 9.1 勾选列表（taskList）

bulletList 的变体，listItem 增加勾选框。作为独立 Block 注册（taskList + taskItem），不修改 bulletList。

### 9.2 拖拽排序增强

列表内 listItem 拖拽排序，支持跨列表、跨层级拖拽。

---

## 十、BlockDef

```typescript
export const bulletListBlock: BlockDef = {
  name: 'bulletList',
  group: 'block',
  nodeSpec: {
    content: 'listItem+',
    group: 'block',
    parseDOM: [{ tag: 'ul' }],
    toDOM() { return ['ul', 0]; },
  },
  capabilities: {
    turnInto: ['paragraph'],
    canDuplicate: true,
    canDelete: true,
    canDrag: true,
  },
  containerRule: {},
  slashMenu: {
    label: 'Bullet List',
    icon: '•',
    group: 'basic',
    keywords: ['list', 'bullet', 'ul', 'unordered'],
    order: 5,
  },
};
```

---

## 十一、设计原则

1. **Container 不管内容**：bulletList 只管"我包含 listItem"，listItem 内部放什么由 listItem 决定
2. **与 orderedList 互转无损**：切换类型时保留所有内容和嵌套
3. **嵌套无限制**：Schema 不限制嵌套深度，视觉上标记循环
4. **溶解为 paragraph**：turnInto paragraph 时展平所有层级
