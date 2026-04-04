# Callout — 提示框

> **类型**：TextBlock groupType 变体（`groupType: 'callout'`）
> **位置**：文档中任意位置
> **状态**：✅ 已实现

---

## 一、定义

Callout 是 TextBlock 的 groupType 变体，带 emoji 图标的提示框。多个连续的 `textBlock { groupType: 'callout' }` 在视觉上组成一个提示框。

```
💡 这是一条提示信息
   可以包含多行内容
```

**不是独立容器节点**——是 textBlock 通过 `groupType: 'callout'` attrs 变体实现的。

---

## 二、实现方式

```typescript
textBlock {
  groupType: 'callout',
  groupAttrs: { emoji: '💡' },   // 提示框图标
  indent: 0,
}
```

视觉装饰通过 group-decoration 插件添加背景色和 emoji 图标（首行显示）。

---

## 三、视觉规格

- 首行左侧显示 emoji 图标（可点击更换）
- 背景色：淡色半透明
- 圆角边框

用 emoji 而非类型（NOTE/WARNING/TIP）——更灵活，不限制类型。

---

## 四、创建方式

| 方式 | 操作 |
|------|------|
| SlashMenu | `/callout` 或 `/提示` |
| HandleMenu | 转换成 → 提示框 |

---

## 五、交互行为

### 5.1 回车（Enter）

| 条件 | 行为 |
|------|------|
| 有内容 | 分裂为两个 callout 行（继承 groupType + emoji） |
| 空行 | 清除 groupType，变为普通段落（退出 callout） |

### 5.2 退格（Backspace，行首）

清除 groupType，变为普通段落，保留文字。

### 5.3 整组拖动

拖拽 callout 行的手柄时，自动收集所有连续的 `groupType: 'callout'` 行，整体移动。

### 5.4 嵌套（设计中）

在 callout 内通过 SlashMenu 插入其他 groupType：

```
💡 提示信息
     • 要点一             ← indent=1, groupType='bullet'
     • 要点二
   提示继续               ← 空行回车退回 callout
```

---

## 六、与旧 callout Container 的关系

旧设计中 callout 是独立 Container 节点（`content: 'block+'`，有 `emoji` attr）。
当前实现已迁移为 textBlock groupType 变体，emoji 存储在 groupAttrs 中。

| 维度 | 旧 callout | 当前 callout |
|------|-----------|-------------|
| 节点类型 | Container（callout > block+） | textBlock attrs 变体 |
| emoji | 容器级 attr | `groupAttrs.emoji` |
| 嵌套 | 容器内放任意 block | indent 层级 + groupType 切换 |

---

## 七、未来升级

### Emoji 选择器

点击 emoji 弹出选择器面板，快速切换图标。
