# paragraph — 段落

> **类型**：Block（叶子，可升级为 Tab Container）
> **位置**：文档中任意位置，最基础的内容单元
> **状态**：✅ 完整实现

---

## 一、定义

paragraph 是编辑器中最基础的 Block——用户输入文字的默认容器。按回车创建新 paragraph，是所有文本编辑的起点。

它也是 Block 转换的起点和终点——大多数 Block 都可以转为 paragraph（"拆解"），大多数 Block 也可以从 paragraph 转换而来（"升级"）。

---

## 二、当前能力

| 能力 | 状态 | 说明 |
|------|------|------|
| 文本输入 | ✅ | 基础文本，支持多行（Shift+Enter 软换行 hardBreak） |
| Mark 格式化 | ✅ | bold / italic / strike / underline / code / link / textStyle / highlight |
| Handle | ✅ | 左侧拖拽手柄，支持拖拽移动 |
| turnInto | ✅ | 可转为 heading / codeBlock / blockquote 等（HandleMenu "转换成"） |
| 首行缩进 | ✅ | HandleMenu "格式 → 首行缩进"，CSS text-indent: 2em |
| 文本对齐 | ✅ | HandleMenu "格式 → 左对齐/居中/右对齐/两端对齐" |
| 格式继承 | ✅ | 新 paragraph 自动继承上一个的 textIndent 和 align |
| 缩进 | ✅ | Tab / Shift+Tab 调整缩进层级（indent attr） |
| 颜色 | ✅ | FloatingToolbar → H（高亮 5 色）/ A（文字 6 色） |
| Link | ✅ | FloatingToolbar → 🔗 → Web 链接 / 笔记链接双模式 |
| 行内公式 | ✅ | FloatingToolbar → ∑ → 选中文字转为 mathInline |
| 复制/剪切 | ✅ | Block 级 + 文字级（ESC 选中后 Cmd+C/X） |
| 删除 | ✅ | Block 级删除（HandleMenu / ContextMenu） |
| 拖拽 | ✅ | Handle 拖拽移动到其他位置 |
| Markdown 输入 | ✅ | # / ## / ### / - / 1. / [] / > / ``` / --- |

---

## 三、Schema

```typescript
nodeSpec: {
  content: 'inline*',
  group: 'block',
  attrs: {
    indent: { default: 0 },         // 缩进级别（0-8），Tab/Shift+Tab
    textIndent: { default: false },  // 首行缩进（CSS text-indent: 2em）
    align: { default: 'left' },      // 对齐方式：left / center / right / justify
  },
  parseDOM: [{ tag: 'p' }],
  toDOM(node) {
    // 动态生成 style：padding-left + text-indent + text-align
  },
}
```

### 说明

- `inline*`：零个或多个 inline 内容（text + hardBreak + mathInline + noteLink）
- `group: 'block'`：属于 block 组，可出现在任何允许 `block+` 的位置
- `indent`：整体缩进（padding-left），Tab 增加，Shift+Tab 减少
- `textIndent`：首行缩进（2em），中文长文阅读体排版
- `align`：文本对齐方式

---

## 四、Capabilities

```typescript
capabilities: {
  turnInto: ['heading', 'codeBlock', 'blockquote'],
  marks: ['bold', 'italic', 'strike', 'underline', 'code', 'link'],
  canDuplicate: true,
  canDelete: true,
  canColor: true,
  canDrag: true,
}
```

### turnInto 说明

paragraph 是 Block 转换的"枢纽"——通过 HandleMenu "转换成" 子菜单操作：

```
paragraph ←→ heading（H1 / H2 / H3）
paragraph ←→ codeBlock
paragraph ←→ blockquote
paragraph ←→ bulletList / orderedList（Markdown 输入）
paragraph ←→ taskList（Markdown 输入 []）
paragraph ←→ toggleList / callout（SlashMenu）
```

---

## 五、HandleMenu 操作

### 转换成 → 子菜单

| 目标 | 图标 | 说明 |
|------|------|------|
| 文本 | T | 保持 paragraph（当前类型 ✓） |
| 标题 1 | H1 | → heading level 1 |
| 标题 2 | H2 | → heading level 2 |
| 标题 3 | H3 | → heading level 3 |
| 代码 | </> | → codeBlock |
| 引用 | 66 | → blockquote |
| 折叠列表 | ▸ | → toggleList |
| 项目符号列表 | • | → bulletList |
| 有序列表 | 1. | → orderedList |

### 格式 → 子菜单

| 选项 | 图标 | attr | 说明 |
|------|------|------|------|
| 首行缩进 | ⇥ | textIndent: boolean | 切换首行缩进（✓ 已启用） |
| 左对齐 | ⫷ | align: 'left' | 默认 |
| 居中 | ⫿ | align: 'center' | 引言、标题式段落 |
| 右对齐 | ⫸ | align: 'right' | 出处、署名 |
| 两端对齐 | ☰ | align: 'justify' | 印刷体排版 |

### 格式继承

新创建的 paragraph（Enter 分裂产生）自动继承上一个 paragraph 的 `textIndent` 和 `align` 属性。

实现：`format-inherit.ts` plugin 的 `appendTransaction`。

---

## 六、FloatingToolbar 操作

选中 paragraph 中的文字后弹出浮动工具栏：

| 按钮 | 功能 | 快捷键 |
|------|------|--------|
| **B** | 加粗 | ⌘B |
| *I* | 斜体 | ⌘I |
| U | 下划线 | ⌘U |
| ~~S~~ | 删除线 | ⌘⇧S |
| `<>` | 行内代码 | ⌘E |
| **H** | 背景高亮（5 色面板） | — |
| **A** | 文字颜色（6 色面板） | — |
| **∑** | 行内公式（选中文字 → mathInline） | — |
| **🔗** | 链接（Web URL / 笔记链接双模式） | — |

### 链接双模式

点击 🔗 进入链接面板模式：

1. **Web 链接**：输入 URL → Enter 确认 → 文字加 `<a>` 链接
2. **笔记链接**：点击"📄 链接到笔记" → 展开笔记搜索列表 → 选择 → 文字加 `krig://note/id` 链接
3. **移除链接**：选中已有链接的文字 → 面板显示"移除链接"

链接交互：
- 双击笔记链接 → 打开目标笔记
- Cmd+Click Web 链接 → 系统浏览器打开
- 右键链接文字 → ContextMenu "移除链接"

---

## 七、交互行为

### 7.1 回车（Enter）

- 段落末尾按 Enter → 创建新空 paragraph（继承 textIndent / align）
- 段落中间按 Enter → 分裂为两个 paragraph
- 空段落按 Enter → 创建新空 paragraph

### 7.2 退格（Backspace）

- 段落开头按 Backspace → 与上一个 paragraph 合并
- 空段落按 Backspace → 删除该 paragraph

### 7.3 Shift+Enter

- 插入 hardBreak（`<br>` 软换行），不创建新段落

### 7.4 Slash 命令

- 空 paragraph 输入 `/` → 触发 SlashMenu
- 选择菜单项 → 当前 paragraph 转换为对应 Block

### 7.5 Markdown 快捷输入（InputRules）

| 输入 | 转换结果 |
|------|---------|
| `# ` | → Heading 1 |
| `## ` | → Heading 2 |
| `### ` | → Heading 3 |
| `- ` 或 `* ` | → Bullet List |
| `1. ` | → Ordered List |
| `[] ` 或 `[ ] ` | → Task List（未勾选） |
| `[x] ` | → Task List（已勾选） |
| `> ` | → Blockquote |
| ` ``` ` | → Code Block |
| `---` | → Horizontal Rule |

---

## 八、与其他 Block 的关系

| 关系 | 说明 |
|------|------|
| **默认 Block** | 回车创建的新 Block 就是 paragraph |
| **转换枢纽** | 大多数 Block 都可以和 paragraph 互转 |
| **容器首子** | 许多 Container 的必填首子是 paragraph（listItem、taskItem、callout 等） |
| **回退目标** | Block 被"溶解"或"取消格式"时回退为 paragraph |
| **SlashMenu 宿主** | `/` 命令在 paragraph 中触发 |
| **格式继承源** | 新 paragraph 继承上一个的首行缩进和对齐 |

---

## 九、BlockDef

```typescript
export const paragraphBlock: BlockDef = {
  name: 'paragraph',
  group: 'block',
  nodeSpec: {
    content: 'inline*',
    group: 'block',
    attrs: {
      indent: { default: 0 },
      textIndent: { default: false },
      align: { default: 'left' },
    },
    parseDOM: [{ tag: 'p' }],
    toDOM(node) { /* 动态生成 style */ },
  },
  capabilities: {
    turnInto: ['heading', 'codeBlock', 'blockquote'],
    marks: ['bold', 'italic', 'strike', 'underline', 'code', 'link'],
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
3. **inline 扩展性**：`content: 'inline*'` 确保未来新增的 inline node（mathInline、noteLink）自动可用
4. **格式继承**：首行缩进和对齐设置在连续输入时自动传递，减少重复操作
5. **零自定义 NodeView**：paragraph 不需要自定义 NodeView，ProseMirror 默认渲染 + toDOM 动态样式即可
6. **思想表达工具定位**：对齐和缩进不是 Word 式排版，而是服务于思想表达的视觉组织手段
