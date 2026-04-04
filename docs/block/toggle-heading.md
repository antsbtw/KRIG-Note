# toggleHeading — 折叠标题

> **类型**：ContainerBlock（见 `base/container-block.md`）
> **位置**：文档中任意位置
> **状态**：待实现

---

## 一、定义

toggleHeading 是可折叠的标题容器——标题行始终可见，子内容可以折叠/展开。

```
展开状态：
▾ 第一章 机器学习基础          ← heading（必填首子，始终可见）
    段落内容...                 ← block*（折叠时隐藏）
    代码示例...
    子 toggleHeading...

折叠状态：
▸ 第一章 机器学习基础          ← heading 仍可见，子内容隐藏
```

它是 heading 的**升级形态**——heading 加上折叠能力就变成 toggleHeading。

---

## 二、Schema

```typescript
nodeSpec: {
  content: 'heading block*',    // 必填首子 heading + 任意 block
  group: 'block',
  attrs: {
    open: { default: true },    // 折叠状态：true=展开，false=折叠
  },
}
```

### content 表达式说明

- `heading`：必填首子，作为折叠标题行，始终可见
- `block*`：零个或多个子内容，折叠时隐藏

---

## 三、Capabilities

```typescript
capabilities: {
  turnInto: ['paragraph', 'heading', 'toggleList'],
  marks: [],           // Container 不接受 Mark（Mark 在内部的 heading 上）
  canIndent: true,     // Tab 嵌套到上一个 toggle 内部
  canDuplicate: false,
  canDelete: true,
  canDrag: true,
}
```

---

## 四、Container 规则

```typescript
containerRule: {
  requiredFirstChildType: 'heading',
  convertTo: 'toggleList',       // heading → paragraph 时，容器转为 toggleList
}
```

**位置安全不变量**：向 toggleHeading 插入 Block 时，必须插入到 heading 之后。

**格式化不变量**：格式化命令只改变首子 heading 的级别（H1/H2/H3），不改变容器结构。

---

## 五、EnterBehavior

```typescript
enterBehavior: {
  action: 'split',
  exitCondition: 'empty-enter',
}
```

- 在标题行按 Enter → 在折叠内容区域创建新 paragraph
- 在子内容的空行按 Enter → 退出 toggleHeading（移到下方）

---

## 六、SlashMenu

```typescript
slashMenu: {
  label: 'Toggle Heading',
  icon: '▸',
  group: 'toggle',
  keywords: ['toggle', 'collapse', 'fold', 'accordion'],
  order: 0,
}
```

---

## 七、交互行为

### 7.1 折叠/展开

- 点击 ▸/▾ 图标 → 切换折叠状态
- 快捷键（待定）→ 切换折叠状态
- 折叠时子内容完全隐藏（DOM 存在但 display: none）

### 7.2 Tab / Shift+Tab（缩进）

| 操作 | 行为 | 条件 |
|------|------|------|
| Tab | toggleHeading 嵌套到上一个同级 toggle 内部 | 必须有上一个兄弟 toggle |
| Shift+Tab | toggleHeading 从父 toggle 中提升出来 | 必须在嵌套 toggle 中 |

```
Tab 示意：
▾ 第一章                    ▾ 第一章
▾ 第二章 ← Tab                  ▾ 第二章 ← 变成第一章的子内容

Shift+Tab 示意：
▾ 第一章                    ▾ 第一章
    ▾ 1.1 节 ← Shift+Tab    ▾ 1.1 节 ← 提升到和第一章同级
```

### 7.3 Enter 行为

| 场景 | 行为 |
|------|------|
| 在标题行末尾按 Enter | 在折叠区域创建新 paragraph（展开） |
| 在子内容空行按 Enter | 退出 toggleHeading |
| 在折叠状态按 Enter | 展开 + 创建 paragraph |

### 7.4 Backspace

| 场景 | 行为 |
|------|------|
| 在标题行开头按 Backspace | toggleHeading → 溶解（heading + 子内容平铺） |
| 子内容为空时 Backspace | 删除空 Block |

---

## 八、NodeView

toggleHeading 需要自定义 NodeView：

```
┌─ toggleHeading ──────────────────────┐
│ ▾ heading 内容（始终可见）           │ ← contentDOM 的第一个子节点
│ ┌─ 折叠区域 ─────────────────────┐  │
│ │ paragraph...                    │  │ ← 折叠时 display: none
│ │ codeBlock...                    │  │
│ │ sub-toggleHeading...            │  │
│ └─────────────────────────────────┘  │
└──────────────────────────────────────┘
```

- ▸/▾ 图标在 heading 左侧
- 点击图标切换 `open` attr
- 折叠区域通过 CSS class 控制显示/隐藏

---

## 九、与 heading 的关系

| 维度 | heading | toggleHeading |
|------|---------|--------------|
| 类型 | 叶子 Block | Container |
| 内容 | 只有标题文字 | 标题 + 折叠子内容 |
| 转换 | heading → toggleHeading（包裹） | toggleHeading → heading（溶解，提取首子） |
| 缩进 | 视觉缩进（indent attr） | 嵌套层级（塞进父 toggle） |
| 大纲 | 参与大纲 | 首子 heading 参与大纲 |

### heading → toggleHeading 转换

paragraph/heading 可以通过 Handle 菜单 "Turn into Toggle Heading" 升级为 toggleHeading：

```
转换前：## 第一章
转换后：▾ 第一章（toggleHeading，首子 heading 继承内容）
```

---

## 十、未来升级路径

### 10.1 Tab Container 升级

toggleHeading 升级为 Tab Container（多语言折叠）：

```
▾ 第一章 [原文] [翻译]
    原文内容...
    Translation content...
```

### 10.2 记忆折叠状态

文档保存时保留每个 toggleHeading 的 open/close 状态。

---

## 十一、BlockDef

```typescript
export const toggleHeadingBlock: BlockDef = {
  name: 'toggleHeading',
  group: 'block',
  nodeSpec: {
    content: 'heading block*',
    group: 'block',
    attrs: { open: { default: true } },
  },
  nodeView: toggleHeadingNodeView,
  plugin: toggleHeadingPlugin,
  enterBehavior: {
    action: 'split',
    exitCondition: 'empty-enter',
  },
  capabilities: {
    turnInto: ['paragraph', 'heading', 'toggleList'],
    canIndent: true,
    canDelete: true,
    canDrag: true,
  },
  containerRule: {
    requiredFirstChildType: 'heading',
    convertTo: 'toggleList',
  },
  slashMenu: {
    label: 'Toggle Heading',
    icon: '▸',
    group: 'toggle',
    keywords: ['toggle', 'collapse', 'fold', 'accordion'],
    order: 0,
  },
};
```

---

## 十二、设计原则

1. **heading 的升级形态**：toggleHeading = heading + 折叠能力。不是独立的概念
2. **必填首子 heading**：标题行始终存在，不可删除。首子类型决定标题级别
3. **折叠不丢失**：折叠时子内容在 DOM 中但隐藏。不删除子节点
4. **缩进即嵌套**：Tab 不是视觉缩进，是把整个 toggleHeading 塞进上一个 toggle
5. **整体移动**：拖拽时 toggleHeading + 所有子内容一起移动
