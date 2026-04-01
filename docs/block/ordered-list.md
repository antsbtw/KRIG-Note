# orderedList — 有序列表

> **类型**：Container（包含 listItem 子节点）
> **位置**：文档中任意位置
> **状态**：待实现

---

## 一、定义

orderedList 是有序列表容器，用数字/字母/罗马标记有顺序的内容。内部包含多个 listItem。

```
1. 第一步
2. 第二步
   a. 子步骤 A      ← 嵌套的 orderedList（字母标记）
   b. 子步骤 B
3. 第三步
```

---

## 二、Schema

```typescript
nodeSpec: {
  content: 'listItem+',
  group: 'block',
  attrs: {
    start: { default: 1 },     // 起始编号
  },
  parseDOM: [{ tag: 'ol', getAttrs(dom: HTMLElement) {
    return { start: dom.hasAttribute('start') ? +dom.getAttribute('start')! : 1 };
  }}],
  toDOM(node) {
    return node.attrs.start === 1
      ? ['ol', 0]
      : ['ol', { start: node.attrs.start }, 0];
  },
}
```

### attrs 说明

- `start`：起始编号，默认 1。支持从任意数字开始编号（如接续上一个列表）

---

## 三、Capabilities

```typescript
capabilities: {
  turnInto: ['paragraph'],       // 溶解 → 每个 listItem 首子成为独立 paragraph
  marks: [],
  canDuplicate: true,
  canDelete: true,
  canDrag: true,
}
```

---

## 四、Container 规则

```typescript
containerRule: {
  requiredFirstChildType: undefined,
}
```

---

## 五、SlashMenu

```typescript
slashMenu: {
  label: 'Numbered List',
  icon: '1.',
  group: 'basic',
  keywords: ['list', 'number', 'ol', 'ordered'],
  order: 6,
}
```

---

## 六、交互行为

### 6.1 创建

- SlashMenu 选择 "Numbered List"
- Markdown 快捷输入：`1. ` + 空格
- 快捷键：待定

### 6.2 编号自动递增

新增 listItem 时，编号自动递增。删除中间 listItem 时，后续编号自动调整。

```
1. Item A
2. Item B    ← 删除
3. Item C    → 自动变为 2. Item C
```

### 6.3 自定义起始编号

通过 HandleMenu 或右键菜单设置 `start` 属性：

```
start: 5
5. Item A
6. Item B
7. Item C
```

用途：一个列表分成多段，中间插入说明文字，后续列表接续编号。

### 6.4 与 bulletList 互转

orderedList ↔ bulletList 直接互转：

```
1. Item A       →      • Item A
2. Item B       →      • Item B
   a. Sub       →        • Sub
```

互转时 `start` 属性丢失（bulletList 不需要）。从 bulletList 转回时 start 重置为 1。

### 6.5 溶解

同 bulletList——每个 listItem 的首子 paragraph 成为独立 paragraph，嵌套展平。

---

## 七、视觉规格

### 编号样式（按嵌套层级变化）

| 层级 | 标记类型 | 示例 | CSS |
|------|---------|------|-----|
| 第 1 级 | 数字 | 1. 2. 3. | `list-style-type: decimal` |
| 第 2 级 | 小写字母 | a. b. c. | `list-style-type: lower-alpha` |
| 第 3 级 | 小写罗马 | i. ii. iii. | `list-style-type: lower-roman` |
| 第 4 级+ | 循环回 decimal | | |

### 间距

同 bulletList：列表前后 0.5em，嵌套每级 24px。

---

## 八、嵌套规则

与 bulletList 完全一致——listItem 的 content 是 `paragraph block*`，允许嵌套任何 block。

orderedList 和 bulletList 可以互相嵌套：

```
1. 有序步骤
   • 无序要点 A     ← orderedList 内的 bulletList
   • 无序要点 B
2. 有序步骤
   1. 子步骤       ← orderedList 内的 orderedList
```

---

## 九、与 bulletList 的差异汇总

| 维度 | bulletList | orderedList |
|------|-----------|-------------|
| 标记 | • ◦ ▪（循环） | 1. a. i.（层级变化） |
| attrs | 无 | `start`（起始编号） |
| Markdown 输入 | `- ` 或 `* ` | `1. ` |
| SlashMenu label | Bullet List | Numbered List |
| 互转 | → orderedList（start=1） | → bulletList（丢失 start） |
| 编号管理 | 无 | 自动递增 + 自定义 start |

---

## 十、未来升级路径

### 10.1 编号格式扩展

增加 `numberStyle` attr：

```typescript
attrs: {
  start: { default: 1 },
  numberStyle: { default: 'decimal' },  // 'decimal' | 'alpha' | 'roman' | 'cjk'
}
```

支持中文编号（一、二、三）等格式。

### 10.2 续编模式

两个 orderedList 之间插入其他 Block 后，第二个 orderedList 自动接续第一个的编号：

```
1. 步骤一
2. 步骤二

（说明文字，不属于列表）

3. 步骤三        ← 自动续编，start=3
4. 步骤四
```

---

## 十一、BlockDef

```typescript
export const orderedListBlock: BlockDef = {
  name: 'orderedList',
  group: 'block',
  nodeSpec: {
    content: 'listItem+',
    group: 'block',
    attrs: { start: { default: 1 } },
    parseDOM: [{ tag: 'ol', getAttrs(dom: HTMLElement) {
      return { start: dom.hasAttribute('start') ? +dom.getAttribute('start')! : 1 };
    }}],
    toDOM(node) {
      return node.attrs.start === 1
        ? ['ol', 0]
        : ['ol', { start: node.attrs.start }, 0];
    },
  },
  capabilities: {
    turnInto: ['paragraph'],
    canDuplicate: true,
    canDelete: true,
    canDrag: true,
  },
  containerRule: {},
  slashMenu: {
    label: 'Numbered List',
    icon: '1.',
    group: 'basic',
    keywords: ['list', 'number', 'ol', 'ordered'],
    order: 6,
  },
};
```

---

## 十二、设计原则

1. **编号自动管理**：用户不需要手动输入数字，插入/删除后自动调整
2. **start 可自定义**：支持接续编号场景
3. **与 bulletList 共享 listItem**：两种列表的子节点是同一种 Block
4. **嵌套层级影响标记**：数字 → 字母 → 罗马，增强可读性
5. **互转无损**（内容层面）：切换时保留所有 listItem，仅丢失 start attr
