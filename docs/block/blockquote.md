# blockquote — 引用

> **类型**：Container（包含 block+ 子节点）
> **位置**：文档中任意位置
> **状态**：基础实现完成

---

## 一、定义

blockquote 是引用容器，用左侧竖线标记引用的内容。可以包含任意 Block。

```
│ 引用的段落文字
│ 可以有多个段落
│
│ 甚至可以嵌套其他 Block
```

---

## 二、当前能力

| 能力 | 状态 | 说明 |
|------|------|------|
| 包含任意 Block | ✅ | paragraph、heading、codeBlock、列表等 |
| Handle | ✅ | 拖拽手柄 |
| turnInto | ✅ | 溶解为 paragraph（子 Block 平铺） |
| 复制 / 删除 / 拖拽 | ✅ | 整体移动 |

---

## 三、Schema

```typescript
nodeSpec: {
  content: 'block+',          // 包含一个或多个 block
  group: 'block',
  defining: true,
  parseDOM: [{ tag: 'blockquote' }],
  toDOM() { return ['blockquote', 0]; },
}
```

### content 说明

`block+`：至少一个 block 子节点。可以包含 paragraph、heading、codeBlock、bulletList、orderedList 等任何属于 block 组的节点。

---

## 四、Capabilities

```typescript
capabilities: {
  turnInto: ['paragraph'],      // 溶解 → 子 Block 平铺为独立 Block
  marks: [],                    // 容器不接受 Mark
  canDuplicate: true,
  canDelete: true,
  canDrag: true,
}
```

---

## 五、Container 规则

```typescript
containerRule: {
  requiredFirstChildType: undefined,  // 无必填首子（任何 block 都可以）
}
```

---

## 六、SlashMenu

```typescript
slashMenu: {
  label: 'Quote',
  icon: '"',
  group: 'basic',
  keywords: ['quote', 'blockquote', 'cite', 'reference'],
  order: 10,
}
```

### Markdown 快捷输入

输入 `> ` + 空格 → 创建 blockquote（将当前 paragraph 包裹进引用）。

---

## 七、交互行为

### 7.1 创建引用

- SlashMenu 选择 "Quote"
- Markdown 输入 `> `
- HandleMenu 选择 "Quote"（将当前 Block 包裹进引用）

### 7.2 退出引用

- 在引用最后一个空 paragraph 按 Enter → 退出引用（空 paragraph 移到引用外面）
- Backspace 在引用首行开头 → 提升（unwrap）引用

### 7.3 嵌套

blockquote 内可以再嵌套 blockquote：

```
│ 第一层引用
│ │ 第二层嵌套引用
│ │ 更深层的引用
│ 回到第一层
```

---

## 八、未来升级路径

### 8.1 引用来源 — 近期

增加 `source` attr，显示引用的来源：

```
│ 引用的文字内容
│ — 来源: 作者名 / URL
```

### 8.2 callout 变体 — 近期

blockquote 的增强版——带类型标识的提示框：

```
💡 NOTE: 这是一条提示
⚠️ WARNING: 这是一条警告
```

callout 作为独立 Block 注册，不修改 blockquote。

### 8.3 Tab Container 升级 — 远期

blockquote 升级为 Tab Container（原文 + 翻译）。

---

## 九、BlockDef

```typescript
export const blockquoteBlock: BlockDef = {
  name: 'blockquote',
  group: 'block',
  nodeSpec: {
    content: 'block+',
    group: 'block',
    defining: true,
    parseDOM: [{ tag: 'blockquote' }],
    toDOM() { return ['blockquote', 0]; },
  },
  capabilities: {
    turnInto: ['paragraph'],
    canDuplicate: true,
    canDelete: true,
    canDrag: true,
  },
  containerRule: {},
  slashMenu: {
    label: 'Quote',
    icon: '"',
    group: 'basic',
    keywords: ['quote', 'blockquote', 'cite', 'reference'],
    order: 10,
  },
};
```

---

## 十、设计原则

1. **通用容器**：blockquote 可包含任意 block，不限于文本
2. **整体移动**：引用移动时容器 + 所有子 Block 一起移动
3. **溶解为平铺**：turnInto paragraph 时，子 Block 提取到引用外面
4. **callout 是独立 Block**：提示框（NOTE/WARNING/TIP）不是 blockquote 的 attrs，而是独立的 Block 类型
