# Bullet List — 无序列表

> **类型**：TextBlock groupType 变体（`groupType: 'bullet'`）
> **位置**：文档中任意位置
> **状态**：✅ 已实现

---

## 一、定义

Bullet List 是 TextBlock 的 groupType 变体，用圆点标记并列的内容要点。多个连续的 `textBlock { groupType: 'bullet' }` 在视觉上组成一个列表。

```
• 要点 A
• 要点 B
• 要点 C
```

**不是独立容器节点**——是 textBlock 通过 `groupType: 'bullet'` attrs 变体实现的。

---

## 二、实现方式

```typescript
textBlock {
  groupType: 'bullet',
  groupAttrs: null,
  indent: 0,          // 缩进层级（每级 24px）
}
```

视觉装饰通过 group-decoration 插件添加圆点标记。

---

## 三、视觉规格

### 标记样式（按 indent 层级循环）

| indent | 标记 | 说明 |
|--------|------|------|
| 0 | • 实心圆 | disc |
| 1 | ◦ 空心圆 | circle |
| 2 | ▪ 实心方 | square |
| 3+ | 循环回 disc | |

缩进时用 `margin-left`（圆点跟随缩进）。

---

## 四、创建方式

| 方式 | 操作 |
|------|------|
| SlashMenu | `/bullet` 或 `/无序` |
| Markdown | 行首输入 `- ` 或 `* ` + 空格 |
| HandleMenu | 转换成 → 项目符号列表 |

---

## 五、交互行为

### 5.1 回车（Enter）

| 条件 | 行为 |
|------|------|
| 有内容 | 分裂为两个 bullet 行（继承 groupType） |
| 空行 | 清除 groupType，变为普通段落（退出列表） |

### 5.2 退格（Backspace，行首）

清除 groupType，变为普通段落，保留文字。

### 5.3 Tab / Shift+Tab

```
Tab → indent += 1（视觉嵌套一级，标记样式随层级变化）
Shift+Tab → indent -= 1
```

### 5.4 与 orderedList 互转

HandleMenu 选择"有序列表"→ 当前行 groupType 从 'bullet' 变为 'ordered'。
内容和 indent 保留。

### 5.5 整组拖动

拖拽 bullet 行的手柄时，自动收集所有连续的 `groupType: 'bullet'` 行，整体移动。

### 5.6 嵌套（设计中）

在 bullet 内通过 SlashMenu 或 Markdown 插入其他 groupType：

```
• 要点 A
• 要点 B
  1. 嵌套编号一          ← indent=1, groupType='ordered'
  2. 嵌套编号二
• 要点 C                  ← 空行回车退回 bullet
```

---

## 六、与旧 bulletList Container 的关系

旧设计中 bulletList 是独立 Container 节点（`content: 'listItem+'`）。
当前实现已迁移为 textBlock groupType 变体。

| 维度 | 旧 bulletList | 当前 bullet |
|------|--------------|------------|
| 节点类型 | Container（bulletList > listItem > paragraph） | textBlock attrs 变体 |
| 嵌套 | listItem 内放 bulletList/orderedList | indent 层级 + groupType 切换 |
| 操作 | 需要容器级 + listItem 级操作 | 与普通 textBlock 相同 |
| 互转 | bulletList ↔ orderedList 容器级转换 | 单行 groupType attr 切换 |
