# listItem — 列表项

> **类型**：Container（bulletList 和 orderedList 的子节点）
> **位置**：只能出现在 bulletList 或 orderedList 内部
> **状态**：待实现

---

## 一、定义

listItem 是列表的子节点。每个列表项是一个 Container——它必须有一个 paragraph 作为首子（主文本），后面可以跟任意 block（子列表、代码块、图片等）。

```
listItem（Container）
  ├── paragraph（必填首子）← 列表项的主文本行
  └── block*（可选子内容）
        ├── paragraph      ← 附加段落
        ├── codeBlock       ← 代码块
        ├── bulletList      ← 嵌套子列表
        ├── image           ← 图片
        └── ...             ← 任意 block
```

**listItem 由 bulletList 和 orderedList 共享**——两种列表的子节点是同一种 Block。

---

## 二、Schema

```typescript
nodeSpec: {
  content: 'paragraph block*',   // 必填首子 paragraph + 任意 block
  defining: true,
  parseDOM: [{ tag: 'li' }],
  toDOM() { return ['li', 0]; },
}
```

### content 表达式说明

- `paragraph`：必填首子，保证每个列表项至少有一行可编辑文本
- `block*`：零个或多个 block，支持子列表、代码块等富内容

### group

listItem 不属于 `block` 组——它只能出现在 bulletList/orderedList 内部，不能独立存在于文档中。

---

## 三、Capabilities

```typescript
capabilities: {
  turnInto: [],                  // 不能单独转换（只能在列表内操作）
  marks: [],                     // 容器不接受 Mark（Mark 在内部的 paragraph 上）
  canIndent: true,               // Tab = 变成子列表，Shift+Tab = 提升
  canDuplicate: true,
  canDelete: true,
  canDrag: true,                 // 列表内拖拽排序
}
```

---

## 四、Container 规则

```typescript
containerRule: {
  requiredFirstChildType: 'paragraph',
}
```

**位置安全不变量**（CLAUDE.md §二.5）：向 listItem 插入 Block 时，必须插入到 paragraph 之后。不能在 paragraph 之前插入，否则违反 `content: 'paragraph block*'` 约束。

---

## 五、交互行为

### 5.1 回车（Enter）

| 场景 | 行为 |
|------|------|
| 在文本末尾按 Enter | 创建新的空 listItem（在当前项之后） |
| 在文本中间按 Enter | 分裂为两个 listItem |
| 在空 listItem 按 Enter | **退出列表**：当前 listItem 变为独立 paragraph |
| 在有子内容的 listItem 末尾按 Enter | 新 listItem 在当前项之后（子内容保留在当前项） |

### 5.2 退格（Backspace）

| 场景 | 行为 |
|------|------|
| 在首子 paragraph 开头按 Backspace | 与上一个 listItem 合并 |
| 第一个 listItem 开头按 Backspace | 提升层级（如果有父列表）或脱离列表 |
| 空 listItem 按 Backspace | 删除该 listItem |

### 5.3 Tab / Shift+Tab（缩进）

| 操作 | 行为 | 约束 |
|------|------|------|
| Tab | 当前 listItem 缩进一级 → 成为上一个 listItem 的子列表 | 必须有上一个兄弟 listItem |
| Shift+Tab | 当前 listItem 提升一级 → 脱离子列表 | 必须在嵌套列表中 |

```
Tab 示意：
• A                    • A
• B  ← Tab             • B        ← B 不变
• C  ← 光标               • C    ← C 变成 B 的子列表

Shift+Tab 示意：
• A                    • A
  • B  ← Shift+Tab     • B        ← B 提升到和 A 同级
  • C                    • C      ← C 跟着提升（或保持为 B 的子列表）
```

### 5.4 拖拽

listItem 可以在列表内拖拽排序。拖拽时整体移动（包含子内容和子列表）。

---

## 六、与父列表的关系

| 维度 | 说明 |
|------|------|
| **bulletList 中的 listItem** | 标记由 bulletList 的嵌套层级决定（• ◦ ▪） |
| **orderedList 中的 listItem** | 编号由 orderedList 自动计算（1. 2. 3.） |
| **嵌套子列表** | listItem 内可以放 bulletList 或 orderedList（互相嵌套） |

---

## 七、未来升级路径

### 7.1 taskItem — 近期

listItem 的变体，增加勾选框。作为独立 Block 注册（不修改 listItem）：

```typescript
// taskItem: listItem 的变体
nodeSpec: {
  content: 'paragraph block*',
  attrs: { checked: { default: false } },
}
```

```
☐ 未完成任务
☑ 已完成任务
```

### 7.2 Tab Container 升级 — 远期

listItem 升级为 Tab Container（多语言等场景）：

```
• 列表项 [原文] [翻译]
```

### 7.3 折叠 listItem — 中期

listItem 有子内容时可以折叠（toggleList 的基础）：

```
▸ 折叠的列表项       ← 子内容隐藏
▾ 展开的列表项
  子内容...
```

---

## 八、BlockDef

```typescript
export const listItemBlock: BlockDef = {
  name: 'listItem',
  group: '',                   // 不属于 block 组，只能在列表中
  nodeSpec: {
    content: 'paragraph block*',
    defining: true,
    parseDOM: [{ tag: 'li' }],
    toDOM() { return ['li', 0]; },
  },
  capabilities: {
    canIndent: true,
    canDuplicate: true,
    canDelete: true,
    canDrag: true,
  },
  containerRule: {
    requiredFirstChildType: 'paragraph',
  },
  slashMenu: null,              // 不出现在 SlashMenu（由列表容器管理）
};
```

---

## 九、设计原则

1. **必填首子 paragraph**：每个 listItem 至少有一行文本，不允许空的 listItem 容器
2. **内容自由**：首子之后可以放任何 block，listItem 是一个功能完整的 Container
3. **共享于两种列表**：bulletList 和 orderedList 共用同一种 listItem
4. **不可独立存在**：listItem 不属于 block 组，不能脱离列表放在文档中
5. **缩进即嵌套**：Tab 创建子列表，不是简单的视觉缩进
6. **空行退出**：在空 listItem 按 Enter 退出列表，最直觉的退出方式
