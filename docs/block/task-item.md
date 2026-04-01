# taskItem — 任务项

> **类型**：Container（taskList 的子节点）
> **位置**：只能在 taskList 内部
> **状态**：待实现

---

## 一、定义

taskItem 是任务列表的子节点——listItem 的变体，增加勾选框。

```
taskItem（Container）
  ├── ☐/☑ 勾选框（NodeView 渲染，不在文档模型中）
  └── paragraph（必填首子）+ block*
```

### taskItem vs listItem

| 维度 | listItem | taskItem |
|------|---------|---------|
| 勾选框 | 无 | ☐/☑（checked attr） |
| content | `paragraph block*` | `paragraph block*`（相同） |
| 交互 | 纯文本 | 点击勾选框切换 checked |
| 视觉 | 列表标记（•/1.） | 勾选框 |

---

## 二、Schema

```typescript
nodeSpec: {
  content: 'paragraph block*',
  attrs: {
    checked: { default: false },
  },
}
```

---

## 三、NodeView

taskItem 需要自定义 NodeView——在 contentDOM 前渲染勾选框：

```
┌─ taskItem ──────────────────────┐
│ [☐] paragraph 文字...            │
│     子内容（block*）             │
└─────────────────────────────────┘
```

勾选框点击 → 切换 `checked` attr → 视觉变化（☐ ↔ ☑，已完成文字变淡）。

---

## 四、Capabilities

```typescript
capabilities: {
  canDelete: true,
  canDrag: true,
}
```

---

## 五、EnterBehavior

```typescript
enterBehavior: {
  action: 'split',
  exitCondition: 'empty-enter',
}
```

- Enter → 创建新 taskItem（默认 checked=false）
- 空 taskItem Enter → 退出 taskList

---

## 六、onIndent / onOutdent

taskItem 的缩进行为和 listItem 类似——嵌套为子任务列表：

```typescript
onIndent: sinkListItem(taskItemType),
onOutdent: liftListItem(taskItemType),
```

```
☐ 任务 A
☐ 任务 B     ← Tab
  ☐ 任务 B   ← 变成 A 的子任务
☐ 任务 C
```

---

## 七、交互行为

### 7.1 勾选框

- 点击 ☐ → 变 ☑，checked=true
- 点击 ☑ → 变 ☐，checked=false
- 已完成任务（checked=true）：文字变淡 + 删除线

### 7.2 键盘

| 按键 | 行为 |
|------|------|
| Enter | 创建新 taskItem（checked=false） |
| Enter（空项） | 退出 taskList |
| Tab | 缩进（子任务） |
| Shift+Tab | 提升层级 |
| Backspace（开头） | 与上一个 taskItem 合并 |

---

## 八、未来升级路径

### 8.1 任务进度

taskList 级别显示完成进度：`3/5 完成`

### 8.2 到期日 / 优先级

taskItem 增加 attrs：
```typescript
attrs: {
  checked: { default: false },
  dueDate: { default: null },
  priority: { default: null },    // 'high' | 'medium' | 'low'
}
```

### 8.3 Tab Container 升级

taskItem 升级为 Tab Container（任务详情）：
```
☐ 任务标题 [详情] [子任务]
    详细描述...
```

---

## 九、BlockDef

```typescript
export const taskItemBlock: BlockDef = {
  name: 'taskItem',
  group: '',
  nodeSpec: {
    content: 'paragraph block*',
    attrs: { checked: { default: false } },
  },
  nodeView: taskItemNodeView,
  enterBehavior: {
    action: 'split',
    exitCondition: 'empty-enter',
  },
  capabilities: {
    canDelete: true,
    canDrag: true,
  },
  containerRule: {
    requiredFirstChildType: 'paragraph',
  },
  slashMenu: null,
};
```

---

## 十、设计原则

1. **listItem 的变体**——结构完全相同（`paragraph block*`），只增加 checked attr 和勾选框 UI
2. **勾选不改结构**——勾选只改 attr，不改文档结构
3. **嵌套通过 onIndent**——Tab 创建子任务列表，和 listItem 一致
4. **退出同 listItem**——空项 Enter 退出
