# Quote — 引用

> **类型**：TextBlock groupType 变体（`groupType: 'quote'`）
> **位置**：文档中任意位置
> **状态**：✅ 已实现

---

## 一、定义

Quote 是 TextBlock 的 groupType 变体，用左侧竖线标记引用内容。多个连续的 `textBlock { groupType: 'quote' }` 在视觉上组成一个引用块。

```
│ 引用的第一行
│ 引用的第二行
│ 可以有多行
```

**不是独立容器节点**——是 textBlock 通过 `groupType: 'quote'` attrs 变体实现的。

---

## 二、实现方式

```typescript
// 不是独立 BlockDef，而是 textBlock 的 attrs 变体
textBlock {
  groupType: 'quote',
  groupAttrs: null,
  indent: 0,          // 缩进层级
}
```

视觉装饰通过 group-decoration 插件的 `Decoration.node` 添加 `.group-quote` class。

---

## 三、视觉规格

```css
.group-quote {
  border-left: 3px solid #555;
  padding-left: 16px;
  color: #aaa;
  font-style: italic;
}
```

缩进时用 `margin-left`（竖线跟随缩进）。

---

## 四、创建方式

| 方式 | 操作 |
|------|------|
| SlashMenu | `/quote` 或 `/引用` |
| Markdown | 行首输入 `> ` + 空格 |
| HandleMenu | 转换成 → 引用 |

---

## 五、交互行为

### 5.1 回车（Enter）

| 条件 | 行为 |
|------|------|
| 有内容 | 分裂为两个 quote 行（继承 groupType） |
| 空行 | 清除 groupType，变为普通段落（退出 quote） |

### 5.2 退格（Backspace，行首）

清除 groupType，变为普通段落，保留文字。

### 5.3 整组拖动

拖拽 quote 行的手柄时，自动收集所有连续的 `groupType: 'quote'` 行，整体移动。

### 5.4 嵌套（设计中）

在 quote 内通过 SlashMenu 插入其他 groupType：

```
│ 引用文字
│   • 嵌套的 bullet    ← indent=1, groupType='bullet'
│   • 另一个要点
│ 引用继续               ← 空行回车退回 quote
```

---

## 六、与旧 blockquote Container 的关系

旧设计中 blockquote 是独立 Container 节点（`content: 'block+'`）。
当前实现已迁移为 textBlock groupType 变体，不再使用 blockquote Container。

| 维度 | 旧 blockquote | 当前 quote |
|------|---------------|------------|
| 节点类型 | 独立 Container | textBlock attrs 变体 |
| 结构 | `blockquote > block+` | 多个连续 `textBlock { groupType: 'quote' }` |
| 嵌套 | blockquote 内嵌 blockquote | indent 层级 + groupType 切换 |
| 操作 | 需要容器级操作 | 与普通 textBlock 相同 |
