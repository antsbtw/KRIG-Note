# Block 关联模型 — 统一 Block 设计

> **文档类型**：架构设计
> **状态**：草案 v2 | 创建日期：2026-04-03
> **前置**：`CLAUDE.md` 中的 Block + Container 二元模型、`design-philosophy.md` P3 原则
>
> **本文档目的**：重新定义 Block 系统——所有 Block 来自同一个基类，容器是 Block 组合的视觉呈现。

---

## 一、核心思想

### Block 只有一种，属性决定一切

```
一个 Block + 不同 attrs = 不同视觉
一组相邻同类 Block = 视觉容器
```

**三条原则：**

1. **回车 = 新 Block**，没有例外
2. **所有 Block 来自同一个基类**，通过 attrs 变体决定视觉呈现
3. **容器 = 一组连续的、相同 groupType 的 Block**，视觉上形成整体

---

## 二、Block 基类

```typescript
interface BlockAttrs {
  // ── 通用排版 ──
  indent: number;                    // 缩进级别（0-8）
  textIndent: boolean;               // 首行缩进
  align: 'left' | 'center' | 'right' | 'justify';

  // ── 组合（决定视觉呈现） ──
  groupType: string | null;          // 组合类型
  groupAttrs: Record<string, unknown> | null;  // 组合专属属性
}
```

仅此而已。没有 `containerId`、`containerType`、`containerHead`——不需要。

---

## 三、groupType 变体

### 3.1 无组合（普通 Block）

```
{ groupType: null }  → 普通段落/标题/代码块等
```

### 3.2 无序列表

```
{ groupType: 'bullet', indent: 0 }  → •  第一项
{ groupType: 'bullet', indent: 0 }  → •  第二项
{ groupType: 'bullet', indent: 1 }  →   ◦ 缩进项
{ groupType: 'bullet', indent: 0 }  → •  回到第一级
{ groupType: null }                  → 普通段落（列表结束）
```

符号由 indent 层级决定：`• → ◦ → ▪ → •`（循环）

### 3.3 有序列表

```
{ groupType: 'ordered', indent: 0 }  → 1. 第一项
{ groupType: 'ordered', indent: 0 }  → 2. 第二项
{ groupType: 'ordered', indent: 1 }  →   a. 缩进项
{ groupType: 'ordered', indent: 0 }  → 3. 回到第一级
```

序号由渲染层扫描连续同 indent 的 ordered Block 自动计算。

### 3.4 任务列表

```
{ groupType: 'task', groupAttrs: { checked: false } }  → ☐ 待办项
{ groupType: 'task', groupAttrs: { checked: true } }   → ☑ 已完成（淡色+删除线）
```

### 3.5 Callout

```
{ groupType: 'callout', groupAttrs: { emoji: '💡' } }  → 💡 ┌ 提示内容
{ groupType: 'callout', groupAttrs: { emoji: '💡' } }  →    │ 第二行
{ groupType: 'callout', groupAttrs: { emoji: '💡' } }  →    └ 第三行
```

首行显示 emoji，整体加背景色和圆角边框。

### 3.6 Blockquote

```
{ groupType: 'quote' }  → ┃ 引用第一行
{ groupType: 'quote' }  → ┃ 引用第二行
```

整体加左侧竖线。

### 3.7 Toggle（折叠）

```
{ groupType: 'toggle', groupAttrs: { open: true } }   → ▾ 折叠标题（首行）
{ groupType: 'toggle' }                                →   子内容（open=false 时隐藏）
{ groupType: 'toggle' }                                →   子内容
```

首行（组内第一个 Block）显示折叠箭头，控制后续同组 Block 的显隐。

### 3.8 Frame（彩框）

```
{ groupType: 'frame', groupAttrs: { color: 'blue' } }  → ┃ 第一行
{ groupType: 'frame', groupAttrs: { color: 'blue' } }  → ┃ 第二行
```

整体加彩色左边框。

---

## 四、组的推导规则

**组的形成**：连续的、相同 `groupType` 的 Block 自动形成一组。

**组的边界**：
- `groupType` 变化 → 组断开
- `groupType` 为 null → 不属于任何组

**组内位置**：渲染层扫描上下文推导每个 Block 在组内的位置：

```typescript
type GroupPosition = 'first' | 'middle' | 'last' | 'only';

function getGroupPosition(doc, pos): GroupPosition {
  const node = doc.nodeAt(pos);
  const prevNode = ...; // 上一个 Block
  const nextNode = ...; // 下一个 Block

  const sameAsPrev = prevNode?.attrs.groupType === node.attrs.groupType;
  const sameAsNext = nextNode?.attrs.groupType === node.attrs.groupType;

  if (!sameAsPrev && !sameAsNext) return 'only';
  if (!sameAsPrev) return 'first';
  if (!sameAsNext) return 'last';
  return 'middle';
}
```

**渲染决策**：

| groupType | first | middle | last | only |
|-----------|-------|--------|------|------|
| bullet | 加 • | 加 • | 加 • | 加 • |
| callout | emoji + 顶部圆角 | 左边框 | 底部圆角 | emoji + 完整圆角 |
| quote | 顶部竖线 | 竖线 | 底部竖线 | 完整竖线 |
| toggle | ▾ 箭头 | 缩进 | 缩进 | ▾ 箭头（无折叠内容） |
| frame | 顶部边框 | 侧边框 | 底部边框 | 完整边框 |

---

## 五、键盘行为（统一）

### 5.1 Enter（回车）

```
有 groupType 时：
  → 创建新 Block，继承 groupType + indent + groupAttrs
  → 任务列表：新 Block 的 checked = false

空行 + Enter 时：
  → 清除 groupType（变为普通段落）
  → 脱离组
```

### 5.2 Tab / Shift-Tab

```
Tab：indent += 1（统一，不区分类型）
Shift-Tab：indent -= 1（最小 0）
```

### 5.3 Backspace（行首）

```
有 groupType 时：
  → 清除 groupType + groupAttrs（变为普通段落，保留文字）

普通段落时：
  → 与上一个 Block 合并
```

### 5.4 Markdown 输入规则

```
- + 空格  → groupType = 'bullet'
* + 空格  → groupType = 'bullet'
1. + 空格 → groupType = 'ordered'
[] + 空格 → groupType = 'task', checked = false
[x] + 空格 → groupType = 'task', checked = true
> + 空格  → groupType = 'quote'
```

---

## 六、渲染实现

### 6.1 ProseMirror Decoration Plugin

一个 Plugin 扫描文档，为每个有 groupType 的 Block 添加 Decoration：

```typescript
function buildGroupDecorations(doc: Node): DecorationSet {
  const decorations: Decoration[] = [];

  doc.forEach((node, pos) => {
    const { groupType, groupAttrs, indent } = node.attrs;
    if (!groupType) return;

    const position = getGroupPosition(doc, pos, node);

    // CSS class 标记位置
    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: `group-${groupType} group-${position}`,
      })
    );

    // 列表符号（widget decoration）
    if (groupType === 'bullet') {
      const symbol = ['•', '◦', '▪'][indent % 3];
      decorations.push(Decoration.widget(pos + 1, createSymbolWidget(symbol)));
    }

    if (groupType === 'ordered') {
      const number = countInGroup(doc, pos, indent);
      decorations.push(Decoration.widget(pos + 1, createSymbolWidget(`${number}.`)));
    }

    if (groupType === 'task') {
      decorations.push(Decoration.widget(pos + 1, createCheckboxWidget(groupAttrs?.checked)));
    }
  });

  return DecorationSet.create(doc, decorations);
}
```

### 6.2 CSS

```css
/* Callout 组 */
.group-callout {
  background: rgba(255,255,255,0.02);
  border-left: 3px solid #444;
  padding-left: 16px;
}
.group-callout.group-first { border-top: 1px solid #444; border-top-left-radius: 6px; padding-top: 8px; }
.group-callout.group-last { border-bottom: 1px solid #444; border-bottom-left-radius: 6px; padding-bottom: 8px; }
.group-callout.group-only { border: 1px solid #444; border-radius: 6px; padding: 8px 16px; }

/* Quote 组 */
.group-quote { border-left: 3px solid #555; padding-left: 16px; color: #aaa; }

/* Toggle 组 */
.group-toggle:not(.group-first) { padding-left: 24px; }

/* Frame 组 */
.group-frame { border-left: 3px solid var(--frame-color, #8ab4f8); padding-left: 16px; }
```

---

## 七、Handle 行为

**每个 Block 都有 Handle**——因为每个 Block 都是独立的。

Handle 操作：
- **拖拽单个 Block** → 移动该 Block（可能脱离组）
- **拖拽组** → 拖拽 group-first 时，自动选中整组一起移动
- **+ 按钮** → 在该 Block 下方创建新 Block（继承 groupType）
- **菜单** → 转换成（改 groupType）、格式、删除

---

## 八、SlashMenu 行为

```
/bullet  → 设置当前 Block 的 groupType = 'bullet'
/ordered → 设置当前 Block 的 groupType = 'ordered'
/task    → 设置当前 Block 的 groupType = 'task'
/callout → 设置当前 Block 的 groupType = 'callout', groupAttrs = { emoji: '💡' }
/quote   → 设置当前 Block 的 groupType = 'quote'
/toggle  → 设置当前 Block 的 groupType = 'toggle', groupAttrs = { open: true }
/frame   → 设置当前 Block 的 groupType = 'frame', groupAttrs = { color: 'blue' }
```

不创建新节点，只修改当前 Block 的 attrs。

---

## 九、与设计哲学的关系

| 原则 | 对齐 |
|------|------|
| P3: Block 是数据组织单元 | ✅ 每个 Block 独立，attrs 携带完整语义 |
| P4: 视图是数据的自然反映 | ✅ groupType 自动推导视觉呈现 |
| 回车 = 新 Block | ✅ 统一，无例外 |
| 基类统一 | ✅ 所有 Block 相同基类，attrs 变体 |

---

## 十、例外

**table** 保持 ProseMirror 原生嵌套结构（`table > tableRow > tableCell`）。二维网格结构不适合展平为一维 Block 序列。

**columnList** 同理——多列布局需要并排关系，不是上下序列。

---

## 十一、迁移路径

### Phase 1：基础设施

1. paragraph nodeSpec 增加 `groupType` + `groupAttrs`
2. 实现 Group Decoration Plugin（位置推导 + CSS class）
3. 实现列表符号 Widget Decoration

### Phase 2：序列型迁移

1. 实现 bullet/ordered/task 的键盘行为
2. Markdown 输入规则适配
3. 删除 bulletList/orderedList/taskList/listItem/taskItem 节点
4. 迁移已有文档数据

### Phase 3：容器型迁移

1. 实现 callout/quote/toggle/frame 的渲染和键盘行为
2. 删除 callout/blockquote/toggleList/frameBlock 节点
3. 迁移已有文档数据

---

## 十二、设计意义

**旧模型**：Block 有两种（叶子和容器），操作行为不同，需要分别处理。

**新模型**：Block 只有一种，属性决定一切。容器是 Block 组合的视觉呈现。

```
单个 Block 的行为 × 组合规则 = 一切视觉效果
```

这是真正的**抽象统一**——不是把复杂度藏起来，而是从根本上消除了复杂度。

---

*本文档为草案 v2。每一阶段实现后回顾设计决策。*
