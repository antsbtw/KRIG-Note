# Container 嵌套设计方案

> **文档类型**：架构设计
> **状态**：草案 v1 | 创建日期：2026-04-04
> **目标**：任何 Container 可以嵌套任何 Container，渲染从内到外，视觉装饰自然延伸

---

## 一、问题

当前系统有两套容器机制：

| 机制 | 类型 | 嵌套能力 | 视觉包裹 |
|------|------|---------|---------|
| **Container 节点** | callout、blockquote、toggleList、frameBlock | ✅ content: 'block+' | ✅ 背景/边框包裹所有子内容 |
| **groupType 变体** | bullet、ordered、task、quote（SlashMenu 注册） | ❌ 扁平 textBlock | ❌ 无法包裹子内容 |

问题：groupType 的 bullet/ordered/task 无法嵌套其他 Container，也无法被 callout/quote 视觉包裹。

Notion 的做法：所有容器都是真正的 Container 节点，子 block 物理上在容器内部，渲染从内到外自然包裹。

---

## 二、目标

```
callout（Container）
  ├── textBlock "提示信息"
  ├── bulletList（Container）
  │     ├── textBlock "要点 A"       ← bullet 装饰
  │     └── textBlock "要点 B"       ← bullet 装饰
  └── textBlock "继续提示"

orderedList（Container）
  ├── textBlock "步骤一"             ← 编号 1.
  ├── bulletList（Container）        ← 嵌套
  │     ├── textBlock "要点"         ← bullet 装饰
  │     └── textBlock "要点"         ← bullet 装饰
  └── textBlock "步骤二"             ← 编号 2.（自动递增）
```

- callout 背景色包裹 bulletList 和所有子内容
- bulletList 的缩进和圆点在 callout 内部正确渲染
- 渲染从内到外：textBlock → bulletList → callout

---

## 三、架构：统一 Container 模型

### 3.1 所有列表类型升级为 Container 节点

| 类型 | 当前 | 目标 |
|------|------|------|
| bulletList | groupType 变体 | Container 节点 `content: 'block+'` |
| orderedList | groupType 变体 | Container 节点 `content: 'block+'` |
| taskList | groupType 变体 | Container 节点 `content: 'block+'` |
| callout | 已是 Container | 保持 |
| blockquote | 已是 Container | 保持 |
| toggleList | 已是 Container | 保持 |

### 3.2 Container 节点 Schema

```typescript
// bulletList
nodeSpec: {
  content: 'block+',
  group: 'block',
  parseDOM: [{ tag: 'ul' }],
  toDOM() { return ['ul', { class: 'list-bullet' }, 0]; },
}

// orderedList
nodeSpec: {
  content: 'block+',
  group: 'block',
  attrs: { start: { default: 1 } },
  parseDOM: [{ tag: 'ol' }],
  toDOM(node) { return ['ol', { class: 'list-ordered', start: node.attrs.start }, 0]; },
}

// taskList
nodeSpec: {
  content: 'block+',
  group: 'block',
  parseDOM: [{ tag: 'ul.task-list' }],
  toDOM() { return ['ul', { class: 'list-task' }, 0]; },
}
```

### 3.3 content: 'block+' 的含义

Container 的子节点可以是任何 `block` 组的节点：

- textBlock（段落/标题）
- bulletList（嵌套无序列表）
- orderedList（嵌套有序列表）
- taskList（嵌套任务列表）
- callout（嵌套提示框）
- blockquote（嵌套引用）
- codeBlock、mathBlock、image 等
- table、columnList 等

**嵌套深度不限制**——ProseMirror Schema 天然支持递归 content 表达式。

---

## 四、渲染：从内到外

ProseMirror 的渲染机制天然从内到外：

```
1. textBlock "要点 A" → 渲染为 <p>要点 A</p>
2. bulletList 包裹 → <ul class="list-bullet"><p>要点 A</p></ul>
   → NodeView 添加 bullet 标记（• 圆点）
3. callout 包裹 → <div class="callout"><ul>...</ul></div>
   → NodeView 添加背景色 + emoji
```

每层 Container 的视觉装饰（背景、边框、标记）自然包裹所有子内容。

### 4.1 列表 Container 的 NodeView

列表 Container 需要 NodeView 来：
- 为每个直接子 textBlock 添加标记（•、1.、☐）
- 标记位置在子 block 左侧
- 嵌套时标记样式按层级变化（disc → circle → square）

```typescript
// bulletList NodeView
const dom = document.createElement('div');
dom.classList.add('list-bullet');

const contentDOM = document.createElement('div');
contentDOM.classList.add('list-bullet__content');
dom.appendChild(contentDOM);

return { dom, contentDOM };
```

标记通过 CSS `::before` 伪元素或 Decoration widget 实现。

### 4.2 嵌套层级检测

CSS 可以用嵌套选择器自动变化标记样式：

```css
/* 第 1 级 bullet */
.list-bullet > .list-bullet__content > p::before { content: '•'; }

/* 第 2 级 bullet（嵌套在另一个 bullet 内） */
.list-bullet .list-bullet > .list-bullet__content > p::before { content: '◦'; }

/* 第 3 级 */
.list-bullet .list-bullet .list-bullet > .list-bullet__content > p::before { content: '▪'; }
```

或者通过 NodeView 在创建时计算 nesting depth 并设为 CSS 变量。

---

## 五、键盘交互

### 5.1 Enter

| 场景 | 行为 |
|------|------|
| 有内容 | 分裂 textBlock（在当前 Container 内） |
| 空行 | 退出当前 Container（textBlock 移到父级） |
| 空行 + 已在顶层 | 清除 Container，变普通段落 |

### 5.2 Tab / Shift+Tab

| 操作 | 行为 |
|------|------|
| Tab | 将当前 textBlock 包裹进新的同类型 Container（嵌套一级） |
| Shift+Tab | 将当前 textBlock 从 Container 中提升到父级 |

### 5.3 Backspace（行首）

退出当前 Container（unwrap），textBlock 移到父级。

### 5.4 SlashMenu

在 Container 内输入 `/bullet` → 在当前位置创建嵌套的 bulletList Container。

---

## 六、与 groupType 的关系

### 6.1 groupType 保留用于什么？

groupType 仍然用于**不需要嵌套包裹**的轻量视觉变体：

| groupType | 是否升级为 Container | 原因 |
|-----------|-------------------|------|
| bullet | ✅ 升级 | 需要嵌套、需要被 callout 包裹 |
| ordered | ✅ 升级 | 同上 |
| task | ✅ 升级 | 同上 |
| quote | ✅ 升级（复用 blockquote） | 需要竖线包裹嵌套内容 |
| callout | 已是 Container | 保持 |
| toggle | 已是 Container（toggleList） | 保持 |
| frame | 已是 Container（frameBlock） | 保持 |

### 6.2 迁移策略

1. **保留 groupType 系统**用于 Decoration（bullet 的 • 标记、task 的 ☐ 等）
2. **新增 Container 节点**（bulletList、orderedList、taskList）用于嵌套包裹
3. **SlashMenu** 创建 Container 节点（而非设置 groupType attr）
4. **Markdown 快捷输入**（`- `、`1. `、`> `）创建 Container 节点

或者更彻底的方案：

1. **Container 节点负责包裹**（bulletList、orderedList、taskList）
2. **Container 的直接子 textBlock** 自动获得对应的视觉标记（不需要 groupType attr）
3. **groupType 废弃**——改为 Container 自动装饰子节点

---

## 七、方案选择

### 方案 A：Container + groupType 共存（渐进式）

- Container 负责包裹和嵌套
- groupType 仍然负责单行的视觉装饰（圆点、编号、checkbox）
- 创建 bulletList 时自动给子 textBlock 设 `groupType: 'bullet'`

优点：改动小，groupType decoration 逻辑复用
缺点：两套系统共存，概念不清晰

### 方案 B：纯 Container（彻底替换）

- Container 的 NodeView 直接渲染子节点的标记
- 不需要 groupType attr
- textBlock 保持纯净（只有 level、indent、align 等排版 attrs）

优点：概念清晰，一套系统
缺点：改动大，需要重写 group-decoration、group-keyboard 等

### 推荐：方案 A（渐进式）

先用方案 A 快速实现嵌套能力，后续如果 groupType 系统成为负担再迁移到方案 B。

---

## 八、实施步骤

### Phase 1：新增 Container 节点

1. 创建 `bulletList` BlockDef（`content: 'block+'`，NodeView 渲染列表外壳）
2. 创建 `orderedList` BlockDef（同上，增加编号逻辑）
3. 创建 `taskList` BlockDef（同上，增加 checkbox）
4. 确保 `content: 'block+'` 允许递归嵌套

### Phase 2：修改创建入口

1. SlashMenu：`/bullet` 创建 `bulletList > textBlock` 而非设置 groupType
2. Markdown 快捷：`- ` 创建 bulletList，`1. ` 创建 orderedList
3. HandleMenu：转换成列表 → 用 Container 包裹

### Phase 3：键盘交互

1. Enter：Container 内分裂 textBlock
2. 空行 Enter：退出 Container
3. Tab：嵌套（创建子 Container）
4. Backspace 行首：退出 Container

### Phase 4：清理

1. 移除 bullet/ordered/task 的 groupType SlashMenu 注册
2. 保留 group-decoration 用于 Container 内的标记渲染
3. 更新测试文档

---

## 九、风险和约束

1. **数据迁移**：现有文档中的 `textBlock { groupType: 'bullet' }` 需要迁移为 `bulletList > textBlock`
2. **Atom 转换器**：`converters/` 需要更新
3. **Block 操作**：turnInto、move、copy 等需要处理 Container 嵌套
4. **性能**：深度嵌套不应影响编辑器性能（ProseMirror 天然支持）

---

*本方案待讨论确认后实施。*
