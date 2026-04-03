# Block 关联模型 — 统一容器设计

> **文档类型**：架构设计
> **状态**：草案 | 创建日期：2026-04-03
> **前置**：`CLAUDE.md` 中的 Block + Container 二元模型
>
> **本文档目的**：重新定义 Container 的实现方式——从 DOM 嵌套改为 Block 关联关系。

---

## 一、核心思想

### 回车 = 新 Block，没有例外

当前系统中，有些 Block（bulletList、callout、blockquote）是 ProseMirror 的嵌套节点——回车在容器内部创建子节点，而不是新的顶层 Block。这导致：

1. 容器内的 Block 没有独立的 Handle
2. 操作方式不统一（容器内 vs 容器外行为不同）
3. DOM 嵌套复杂，样式和定位困难

**新设计**：所有 Block 都是扁平的、独立的。容器是通过 **Block 之间的关联关系** 在视觉上呈现的，不是通过 DOM 嵌套。

---

## 二、从嵌套到关联

### 2.1 当前模型（嵌套）

```
doc
  ├── paragraph "正文"
  ├── bulletList                    ← Container 节点
  │     ├── listItem
  │     │     └── paragraph "项目 1"
  │     └── listItem
  │           └── paragraph "项目 2"
  ├── callout { emoji: '💡' }      ← Container 节点
  │     ├── paragraph "提示内容"
  │     └── paragraph "第二行"
  └── paragraph "正文"
```

问题：
- bulletList 内的 paragraph 不是独立 Block，没有 Handle
- callout 内的 paragraph 也不是独立 Block
- 不同容器需要不同的键盘处理逻辑

### 2.2 新模型（关联）

```
doc
  ├── block "正文"
  ├── block "项目 1"    { listType: 'bullet', indent: 0 }
  ├── block "项目 2"    { listType: 'bullet', indent: 0 }
  ├── block "提示内容"  { containerId: 'c1', containerType: 'callout', containerHead: true, emoji: '💡' }
  ├── block "第二行"    { containerId: 'c1', containerType: 'callout' }
  └── block "正文"
```

每一行都是独立 Block。容器关系通过 attrs 表达。

---

## 三、Block attrs 设计

### 3.1 基础 attrs（所有 Block 共享）

```typescript
interface BlockAttrs {
  // 已有
  indent: number;           // 缩进级别（0-8）
  textIndent: boolean;      // 首行缩进
  align: 'left' | 'center' | 'right' | 'justify';

  // 新增：序列关系
  listType: 'bullet' | 'ordered' | 'task' | null;
  checked: boolean;         // taskList 专用

  // 新增：容器关系
  containerId: string | null;       // 所属容器 ID（相同 ID = 同一容器）
  containerType: string | null;     // 容器类型（'callout' | 'quote' | 'toggle' | 'frame'）
  containerHead: boolean;           // 是否是容器的首行
  containerAttrs: Record<string, unknown> | null;  // 容器专属属性（emoji、color 等）
}
```

### 3.2 序列型（listType 驱动）

无序列表、有序列表、任务列表不需要 `containerId`——它们通过 **相邻 Block 的 listType + indent** 推导关系。

```
block { listType: 'bullet', indent: 0 }    → • 第一项
block { listType: 'bullet', indent: 0 }    → • 第二项
block { listType: 'bullet', indent: 1 }    →   ◦ 缩进项
block { listType: 'bullet', indent: 1 }    →   ◦ 缩进项
block { listType: 'bullet', indent: 0 }    → • 回到第一级
block { listType: null }                    → 普通段落（列表结束）
```

**有序列表自动编号**：渲染层扫描连续的 `listType: 'ordered'` + 同 indent 级别，自动计算序号。

```
block { listType: 'ordered', indent: 0 }   → 1. 第一项
block { listType: 'ordered', indent: 0 }   → 2. 第二项
block { listType: 'ordered', indent: 1 }   →   a. 缩进项
block { listType: 'ordered', indent: 0 }   → 3. 回到第一级
```

**任务列表**：

```
block { listType: 'task', checked: false }  → ☐ 待办项
block { listType: 'task', checked: true }   → ☑ 已完成
```

### 3.3 容器型（containerId 驱动）

callout、blockquote、toggleList、frameBlock 通过 `containerId` 关联。

**Callout**：

```
block { containerId: 'c1', containerType: 'callout', containerHead: true, containerAttrs: { emoji: '💡' } }
  → 💡 ┌ 提示内容（首行，显示 emoji + 容器顶部边框）
block { containerId: 'c1', containerType: 'callout' }
  →    │ 第二行（中间行，显示左边框）
block { containerId: 'c1', containerType: 'callout' }
  →    └ 第三行（末行，显示底部边框——通过检测下一个 Block 是否同 containerId 推导）
```

**Blockquote**：

```
block { containerId: 'q1', containerType: 'quote', containerHead: true }
  → ┃ 引用第一行
block { containerId: 'q1', containerType: 'quote' }
  → ┃ 引用第二行
```

**Toggle**：

```
block { containerId: 't1', containerType: 'toggle', containerHead: true, containerAttrs: { open: true } }
  → ▾ 折叠标题（点击切换 open）
block { containerId: 't1', containerType: 'toggle' }
  →   子内容（open=false 时隐藏）
block { containerId: 't1', containerType: 'toggle' }
  →   子内容
```

**Frame**：

```
block { containerId: 'f1', containerType: 'frame', containerHead: true, containerAttrs: { color: 'blue' } }
  → ┃ 第一行（蓝色左边框）
block { containerId: 'f1', containerType: 'frame' }
  → ┃ 第二行
```

---

## 四、渲染机制

### 4.1 序列型渲染（ProseMirror Decoration）

用 `DecorationSet` 在每个 `listType` Block 前面添加列表符号：

```typescript
// Plugin 的 decorations 函数
function buildListDecorations(doc: Node): DecorationSet {
  const decorations: Decoration[] = [];
  let orderedCounter: Record<number, number> = {};  // indent → counter

  doc.forEach((node, pos) => {
    const { listType, indent } = node.attrs;

    if (listType === 'bullet') {
      const symbol = ['•', '◦', '▪'][indent % 3];
      decorations.push(Decoration.widget(pos, () => createBulletWidget(symbol, indent)));
    }

    if (listType === 'ordered') {
      orderedCounter[indent] = (orderedCounter[indent] || 0) + 1;
      const number = orderedCounter[indent];
      decorations.push(Decoration.widget(pos, () => createOrderedWidget(number, indent)));
    }

    if (listType === 'task') {
      decorations.push(Decoration.widget(pos, () => createCheckboxWidget(node.attrs.checked, pos)));
    }

    // 重置：当 listType 断开时，重置有序编号
    if (listType !== 'ordered') {
      orderedCounter = {};
    }
  });

  return DecorationSet.create(doc, decorations);
}
```

### 4.2 容器型渲染（CSS + Decoration）

容器的边框通过 CSS class 实现，由 Plugin 根据上下文添加：

```typescript
function buildContainerDecorations(doc: Node): DecorationSet {
  const decorations: Decoration[] = [];

  doc.forEach((node, pos) => {
    const { containerId, containerType, containerHead } = node.attrs;
    if (!containerId) return;

    // 判断是否是容器的最后一行
    const nextNode = doc.nodeAt(pos + node.nodeSize);
    const isLast = !nextNode || nextNode.attrs.containerId !== containerId;
    const isFirst = containerHead;

    // 添加 CSS class
    const classes = [`container-${containerType}`];
    if (isFirst) classes.push('container-first');
    if (isLast) classes.push('container-last');
    if (!isFirst && !isLast) classes.push('container-middle');

    decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: classes.join(' ') }));
  });

  return DecorationSet.create(doc, decorations);
}
```

CSS 示例：

```css
/* Callout 容器 */
.container-callout {
  border-left: 3px solid #444;
  padding-left: 16px;
  background: rgba(255,255,255,0.02);
}
.container-callout.container-first {
  border-top: 1px solid #444;
  border-top-left-radius: 6px;
  padding-top: 8px;
}
.container-callout.container-last {
  border-bottom: 1px solid #444;
  border-bottom-left-radius: 6px;
  padding-bottom: 8px;
}
```

---

## 五、键盘行为

### 5.1 统一的回车行为

```
Enter：
  1. 创建新 Block（继承 listType / containerId）
  2. 新 Block 的 containerHead = false

空行 + Enter：
  1. 清除 listType / containerId（脱离序列/容器）
  2. 变为普通 paragraph
```

### 5.2 Tab / Shift-Tab

```
Tab：
  indent += 1（所有 Block 统一）
  如果在列表中，视觉上变为子列表

Shift-Tab：
  indent -= 1
  indent = 0 时不再减少
```

### 5.3 Backspace

```
行首 Backspace：
  如果有 listType → 清除 listType（变普通段落，保留文字）
  如果有 containerId → 清除 containerId（脱离容器）
  如果是普通段落 → 和上一个 Block 合并
```

---

## 六、与 CLAUDE.md 不变量的关系

### 兼容性分析

| 不变量 | 影响 | 说明 |
|--------|------|------|
| Block 能力不变量 | ✅ 兼容 | 每个 Block 保留全部能力，因为都是独立 Block |
| Container 能力不变量 | ⚠️ 重新定义 | Container 不再是 ProseMirror 节点，而是 Block 关联关系 |
| 整体移动不变量 | ⚠️ 需要新机制 | 移动容器 = 移动所有共享 containerId 的 Block |
| 内容合法性不变量 | ✅ 简化 | 不再有 content 表达式限制 |
| 位置安全不变量 | ✅ 简化 | 没有"必填首子"的概念 |
| 格式化不变量 | ✅ 兼容 | 格式化只改 attrs |

### 需要更新的不变量

- **整体移动**：拖拽容器首行 Block 时，自动选中所有同 containerId 的 Block 一起移动
- **Container 定义**：Container 不再是节点类型，而是 Block attrs 的语义关系

---

## 七、迁移路径

### Phase 1：序列型（bulletList → listType attr）

1. paragraph 增加 `listType` / `checked` attrs
2. 实现列表符号 Decoration Plugin
3. 实现键盘行为（Enter 继承、空行退出、Tab 缩进）
4. Markdown 输入规则适配
5. 删除 bulletList / orderedList / taskList / listItem / taskItem 节点
6. 迁移已有文档数据

### Phase 2：容器型（callout → containerId attr）

1. paragraph/heading 增加 `containerId` / `containerType` / `containerHead` / `containerAttrs`
2. 实现容器边框 Decoration Plugin
3. 实现键盘行为（Enter 继承、空行退出）
4. SlashMenu 适配（创建容器 = 设置当前 Block 的 attrs）
5. 删除 callout / blockquote / toggleList / frameBlock 节点
6. 迁移已有文档数据

### Phase 3：Toggle 折叠

1. `containerType: 'toggle'` + `containerAttrs: { open: boolean }`
2. 折叠 = 隐藏非 containerHead 的同 containerId Block
3. Decoration 控制 `display: none`

---

## 八、设计意义

### 8.1 抽象的统一

**旧模型**：Block 有两种——叶子 Block 和 Container Block，操作行为不同。

**新模型**：所有 Block 行为相同，容器是 Block 关联关系的视觉呈现。

```
单个 Block 的行为 × 关联关系 = 容器行为
```

容器不是新的概念，而是基础 Block 行为的**组合**。

### 8.2 语义的丰富

Block 的 `containerId` 天然成为知识图谱的关系边：

```
Block A ──belongs_to──> Container C1
Block B ──belongs_to──> Container C1
```

这和 P3（Block 是数据组织单元）完全一致——关联关系既服务于视图渲染，也服务于数据层。

### 8.3 操作的简化

- 每个 Block 都有 Handle → 操作入口统一
- 不需要区分"容器内操作"和"容器外操作" → 学习成本降低
- 回车永远创建新 Block → 心智模型简单

---

## 九、风险与约束

1. **数据迁移**：已有文档的 bulletList/callout 等嵌套结构需要展平为关联 Block
2. **ProseMirror 兼容性**：ProseMirror 的 Schema 系统是基于嵌套的，关联模型需要在其上层实现
3. **复杂容器**：table 是二维嵌套结构，不适合展平——table 保持原有 Container 方式
4. **性能**：每次渲染需要扫描上下文推导关联关系，需要缓存优化

---

*本文档为草案，需要逐步验证和细化。每一阶段实现后回顾设计决策。*
