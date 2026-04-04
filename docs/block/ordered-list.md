# Ordered List — 有序列表

> **类型**：TextBlock groupType 变体（`groupType: 'ordered'`）
> **位置**：文档中任意位置
> **状态**：✅ 已实现

---

## 一、定义

Ordered List 是 TextBlock 的 groupType 变体，用数字标记有顺序的内容。多个连续的 `textBlock { groupType: 'ordered' }` 在视觉上组成一个编号列表。

```
1. 第一步
2. 第二步
3. 第三步
```

**不是独立容器节点**——是 textBlock 通过 `groupType: 'ordered'` attrs 变体实现的。

---

## 二、实现方式

```typescript
textBlock {
  groupType: 'ordered',
  groupAttrs: null,
  indent: 0,
}
```

编号由 group-decoration 插件根据连续同组 blocks 的位置自动计算。

---

## 三、视觉规格

### 编号样式（按 indent 层级变化）

| indent | 标记类型 | 示例 |
|--------|---------|------|
| 0 | 数字 | 1. 2. 3. |
| 1 | 小写字母 | a. b. c. |
| 2 | 小写罗马 | i. ii. iii. |
| 3+ | 循环回数字 | |

编号自动递增——插入/删除后自动调整。

---

## 四、创建方式

| 方式 | 操作 |
|------|------|
| SlashMenu | `/numbered` 或 `/有序` |
| Markdown | 行首输入 `1. ` + 空格 |
| HandleMenu | 转换成 → 有序列表 |

---

## 五、交互行为

### 5.1 回车（Enter）

| 条件 | 行为 |
|------|------|
| 有内容 | 分裂为两个 ordered 行（继承 groupType，编号自动递增） |
| 空行 | 清除 groupType，变为普通段落（退出列表） |

### 5.2 退格（Backspace，行首）

清除 groupType，变为普通段落，保留文字。

### 5.3 Tab / Shift+Tab

```
Tab → indent += 1（编号样式随层级变化：数字 → 字母 → 罗马）
Shift+Tab → indent -= 1
```

### 5.4 与 bulletList 互转

HandleMenu 选择"项目符号列表"→ groupType 从 'ordered' 变为 'bullet'。

### 5.5 整组拖动

拖拽 ordered 行的手柄时，自动收集所有连续的 `groupType: 'ordered'` 行，整体移动。

### 5.6 嵌套（设计中）

在 ordered 内通过 SlashMenu 或 Markdown 插入其他 groupType：

```
1. 有序步骤一
2. 有序步骤二
   • 无序要点 A          ← indent=1, groupType='bullet'
   • 无序要点 B
3. 有序步骤三              ← 空行回车退回 ordered
```

---

## 六、与 bulletList 的差异

| 维度 | bullet | ordered |
|------|--------|---------|
| 标记 | • ◦ ▪（循环） | 1. a. i.（层级变化） |
| 编号管理 | 无 | 自动递增 |
| Markdown 输入 | `- ` 或 `* ` | `1. ` |
| 互转 | → ordered | → bullet |

---

## 七、与旧 orderedList Container 的关系

旧设计中 orderedList 是独立 Container 节点（`content: 'listItem+'`，有 `start` attr）。
当前实现已迁移为 textBlock groupType 变体。

| 维度 | 旧 orderedList | 当前 ordered |
|------|---------------|-------------|
| 节点类型 | Container（orderedList > listItem > paragraph） | textBlock attrs 变体 |
| start attr | 支持自定义起始编号 | 编号从 1 自动计算 |
| 嵌套 | listItem 内放子列表 | indent 层级 + groupType 切换 |

### 未来：自定义起始编号

可通过 groupAttrs 支持：

```typescript
groupAttrs: { start: 5 }  // 从 5 开始编号
```
