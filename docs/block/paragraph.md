# paragraph — 段落

> **类型**：Block（叶子，可升级为 Tab Container）
> **位置**：文档中任意位置，最基础的内容单元
> **状态**：基础实现完成

---

## 一、定义

paragraph 是编辑器中最基础的 Block——用户输入文字的默认容器。按回车创建新 paragraph，是所有文本编辑的起点。

它也是 Block 转换的起点和终点——大多数 Block 都可以转为 paragraph（"拆解"），大多数 Block 也可以从 paragraph 转换而来（"升级"）。

---

## 二、当前能力

| 能力 | 状态 | 说明 |
|------|------|------|
| 文本输入 | ✅ | 基础文本，支持多行（Shift+Enter 软换行） |
| Mark 格式化 | ✅ | bold / italic / strike / underline / code / link |
| Handle | ✅ | 左侧拖拽手柄，支持拖拽移动 |
| turnInto | ✅ | 可转为 heading / codeBlock / blockquote 等 |
| 缩进 | ✅ | Tab / Shift+Tab 调整缩进层级 |
| 颜色 | ✅ | 文本颜色 + 背景高亮色 |
| 复制 | ✅ | Block 级复制 |
| 删除 | ✅ | Block 级删除 |
| 拖拽 | ✅ | 拖拽到其他位置 |

---

## 三、Schema

```typescript
nodeSpec: {
  content: 'inline*',       // 支持文本 + inline node（mathInline、mention 等）
  group: 'block',
  parseDOM: [{ tag: 'p' }],
  toDOM() { return ['p', 0]; },
}
```

### 说明

- `inline*`：零个或多个 inline 内容（text + inline node）
- `group: 'block'`：属于 block 组，可出现在任何允许 `block+` 的位置
- 未来增加 `attrs`：indent、textAlign（缩进和对齐）

---

## 四、Capabilities

```typescript
capabilities: {
  turnInto: [
    'heading',           // → 标题（H1-H6）
    'codeBlock',         // → 代码块
    'blockquote',        // → 引用
    // 未来扩展：
    // 'bulletList',     // → 无序列表
    // 'orderedList',    // → 有序列表
    // 'taskList',       // → 任务列表
    // 'toggleHeading',  // → 折叠标题
    // 'toggleList',     // → 折叠列表
    // 'callout',        // → 提示框
  ],
  marks: ['bold', 'italic', 'strike', 'underline', 'code', 'link'],
  canIndent: true,
  canDuplicate: true,
  canDelete: true,
  canColor: true,
  canDrag: true,
}
```

### turnInto 说明

paragraph 是 Block 转换的"枢纽"——几乎所有 Block 都可以和 paragraph 互转：

```
paragraph ←→ heading
paragraph ←→ codeBlock
paragraph ←→ blockquote
paragraph ←→ bulletList / orderedList
paragraph ←→ toggleHeading / toggleList
paragraph ←→ callout
```

当一个复杂 Block（如 toggleHeading）被"溶解"时，其内容回退为 paragraph。

---

## 五、SlashMenu

```typescript
slashMenu: {
  label: 'Paragraph',
  icon: '¶',
  group: 'basic',
  order: 0,
}
```

出现在 SlashMenu 的 "basic" 分组中，排序最靠前。用户输入 `/` 后默认第一项。

---

## 六、交互行为

### 6.1 回车（Enter）

- 在段落末尾按 Enter → 创建新的空 paragraph
- 在段落中间按 Enter → 分裂为两个 paragraph
- 在空段落按 Enter → 创建新空 paragraph（保持空段落）

### 6.2 退格（Backspace）

- 在段落开头按 Backspace → 与上一个 paragraph 合并
- 空段落按 Backspace → 删除该 paragraph，光标移到上一个 Block

### 6.3 Slash 命令

- 在空 paragraph 中输入 `/` → 触发 SlashMenu
- 选择菜单项 → 当前 paragraph 转换为对应 Block 类型

### 6.4 Markdown 快捷输入（InputRules，未来实现）

| 输入 | 转换结果 |
|------|---------|
| `# ` | → Heading 1 |
| `## ` | → Heading 2 |
| `> ` | → Blockquote |
| `- ` | → Bullet List |
| `1. ` | → Ordered List |
| `[] ` | → Task List |
| ` ``` ` | → Code Block |
| `---` | → Horizontal Rule |

---

## 七、未来升级路径

### 7.1 缩进和对齐 — 近期

```typescript
attrs: {
  indent: { default: 0 },          // 缩进级别（0-8）
  textAlign: { default: null },     // 'left' | 'center' | 'right' | null
}
```

Tab / Shift+Tab 调整 indent。对齐通过 HandleMenu 或快捷键设置。

### 7.2 颜色 — 近期

通过 `textStyle`（文本颜色）和 `highlight`（背景高亮）两个 Mark 实现，不是 paragraph 的 attrs。

```typescript
// 选中文字后设置颜色
marks: [..., 'textStyle', 'highlight']
```

### 7.3 多语言翻译 — 中期

paragraph 升级为 Tab Container：

```
默认（叶子）：
┌──────────────────┐
│ 段落文字           │
└──────────────────┘

升级后（Tab Container）：
┌──────────────────────────┐
│ [原文] [翻译]              │
├──────────────────────────┤
│ 段落文字（原文）           │
│ Translated text（翻译）   │
└──────────────────────────┘
```

### 7.4 AI 改写 — 远期

paragraph 升级为 Tab Container：

```
[原文] [简化版] [学术版]
```

用户选择 AI 改写后，原文保留，改写版本作为新 Tab。

### 7.5 Mention / Inline Node — 近期

`content: 'inline*'` 天然支持未来的 inline node：

- `mathInline`：行内公式
- `mention`：@提及（用户/文档/概念）
- `noteLink`：笔记内链

注册对应的 inline Block 后，paragraph 自动支持。

---

## 八、与其他 Block 的关系

| 关系 | 说明 |
|------|------|
| **默认 Block** | 回车创建的新 Block 就是 paragraph |
| **转换枢纽** | 大多数 Block 都可以和 paragraph 互转 |
| **容器首子** | 许多 Container 的必填首子是 paragraph（如 listItem、taskItem） |
| **回退目标** | Block 被"溶解"或"取消格式"时回退为 paragraph |
| **SlashMenu 宿主** | `/` 命令在 paragraph 中触发 |

---

## 九、BlockDef

```typescript
export const paragraphBlock: BlockDef = {
  name: 'paragraph',
  group: 'block',
  nodeSpec: {
    content: 'inline*',
    group: 'block',
    parseDOM: [{ tag: 'p' }],
    toDOM() { return ['p', 0]; },
  },
  capabilities: {
    turnInto: ['heading', 'codeBlock', 'blockquote'],
    marks: ['bold', 'italic', 'strike', 'underline', 'code', 'link'],
    canIndent: true,
    canDuplicate: true,
    canDelete: true,
    canColor: true,
    canDrag: true,
  },
  slashMenu: {
    label: 'Paragraph',
    icon: '¶',
    group: 'basic',
    order: 0,
  },
};
```

---

## 十、设计原则

1. **最基础的 Block**：paragraph 是编辑器的"原子"，所有复杂 Block 都可以回退到 paragraph
2. **转换枢纽**：paragraph 是 Block 转换网络的中心节点
3. **inline 扩展性**：`content: 'inline*'` 确保未来新增的 inline node 自动在 paragraph 中可用
4. **升级而非重写**：多语言、AI 改写都通过 Tab Container 升级实现
5. **零自定义 NodeView**：paragraph 不需要自定义 NodeView，ProseMirror 默认渲染即可
