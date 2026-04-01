# toggleList — 折叠列表

> **类型**：Container（block+ 子节点，无必填首子）
> **位置**：文档中任意位置
> **状态**：待实现

---

## 一、定义

toggleList 是可折叠的列表容器——首行作为摘要始终可见，子内容可以折叠/展开。与 toggleHeading 不同，toggleList 没有必填首子——首行是 paragraph 而非 heading。

```
展开状态：
▾ 这是折叠列表的摘要行          ← paragraph（首行，始终可见）
    详细内容段落...              ← block*（折叠时隐藏）
    代码示例...

折叠状态：
▸ 这是折叠列表的摘要行          ← 首行仍可见，子内容隐藏
```

---

## 二、toggleList vs toggleHeading

| 维度 | toggleHeading | toggleList |
|------|--------------|------------|
| 首子 | heading（必填，H1-H3） | 无必填首子（通常是 paragraph） |
| 用途 | 章节折叠（结构化大纲） | 细节折叠（FAQ、步骤详情） |
| 大纲 | 参与文档大纲 | 不参与大纲 |
| 视觉 | 大字号标题 | 正常字号 |
| 互转 | toggleHeading → toggleList（heading → paragraph 时） | toggleList → toggleHeading（首行转为 heading 时） |

---

## 三、Schema

```typescript
nodeSpec: {
  content: 'block+',           // 任意 block（无必填首子）
  group: 'block',
  attrs: {
    open: { default: true },    // 折叠状态
  },
}
```

---

## 四、Capabilities

```typescript
capabilities: {
  turnInto: ['paragraph', 'toggleHeading'],
  marks: [],
  canIndent: true,     // Tab 嵌套
  canDuplicate: false,
  canDelete: true,
  canDrag: true,
}
```

---

## 五、Container 规则

```typescript
containerRule: {
  requiredFirstChildType: undefined,  // 无必填首子
}
```

---

## 六、EnterBehavior

```typescript
enterBehavior: {
  action: 'split',
  exitCondition: 'empty-enter',
}
```

- 在首行按 Enter → 在折叠内容区域创建新 paragraph
- 在子内容的空行按 Enter → 退出 toggleList

---

## 七、SlashMenu

```typescript
slashMenu: {
  label: 'Toggle List',
  icon: '▸',
  group: 'toggle',
  keywords: ['toggle', 'collapse', 'fold', 'detail', 'summary'],
  order: 1,
}
```

---

## 八、交互行为

### 8.1 折叠/展开

与 toggleHeading 相同：
- 点击 ▸/▾ 图标切换
- 折叠时子内容隐藏（首行后面的所有 block）

### 8.2 Tab / Shift+Tab

| 操作 | 行为 |
|------|------|
| Tab | toggleList 嵌套到上一个同级 toggle 内部 |
| Shift+Tab | 从父 toggle 中提升出来 |

### 8.3 首行的定义

toggleList 没有 `requiredFirstChildType`，但视觉上第一个 block 作为"摘要行"始终可见。折叠时隐藏的是第二个 block 开始的所有内容。

```
content: block+
         ↑ 第一个 = 摘要行（始终可见）
           ↑ 第二个开始 = 折叠区域
```

---

## 九、NodeView

```
┌─ toggleList ─────────────────────────┐
│ ▾ 摘要行 paragraph（始终可见）       │
│ ┌─ 折叠区域 ─────────────────────┐  │
│ │ paragraph...                    │  │
│ │ codeBlock...                    │  │
│ └─────────────────────────────────┘  │
└──────────────────────────────────────┘
```

---

## 十、与 toggleHeading 的互转

```
toggleList:
▾ 普通文字摘要
    子内容...

turnInto toggleHeading:
▾ 普通文字摘要 → H2 标题     ← 首行 paragraph 转为 heading
    子内容...（保留）

toggleHeading:
▾ H2 标题
    子内容...

turnInto toggleList:
▾ H2 标题 → 普通文字         ← 首子 heading 转为 paragraph
    子内容...（保留）
```

---

## 十一、BlockDef

```typescript
export const toggleListBlock: BlockDef = {
  name: 'toggleList',
  group: 'block',
  nodeSpec: {
    content: 'block+',
    group: 'block',
    attrs: { open: { default: true } },
  },
  nodeView: toggleListNodeView,
  plugin: toggleListPlugin,
  enterBehavior: {
    action: 'split',
    exitCondition: 'empty-enter',
  },
  capabilities: {
    turnInto: ['paragraph', 'toggleHeading'],
    canIndent: true,
    canDelete: true,
    canDrag: true,
  },
  containerRule: {},
  slashMenu: {
    label: 'Toggle List',
    icon: '▸',
    group: 'toggle',
    keywords: ['toggle', 'collapse', 'fold', 'detail', 'summary'],
    order: 1,
  },
};
```

---

## 十二、设计原则

1. **无必填首子**：与 toggleHeading 的核心区别。任何 block 都可以作为首行
2. **首行 = 摘要**：视觉上第一个 block 始终可见，作为折叠摘要
3. **与 toggleHeading 互转**：首行 paragraph ↔ heading 决定了容器类型
4. **缩进即嵌套**：Tab 把 toggleList 塞进上一个 toggle，不是视觉缩进
5. **整体移动**：拖拽时所有子内容一起移动
