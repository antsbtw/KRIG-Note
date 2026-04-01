# noteLink — 笔记内链

> **类型**：Inline 节点（atom）
> **位置**：任何接受 inline 内容的 Block 内部
> **状态**：待实现

---

## 一、定义

noteLink 是指向另一个 NoteFile 的内链——渲染为可点击的链接，显示目标 NoteFile 的标题。

```
请参考 [[线性代数笔记]] 中的内容
```

---

## 二、Schema

```typescript
nodeSpec: {
  inline: true,
  group: 'inline',
  atom: true,                  // 不可编辑内部内容
  attrs: {
    noteId: {},                // 目标 NoteFile 的 ID
    label: { default: '' },    // 显示文字（从 NoteFile 标题自动派生）
  },
}
```

### atom 说明

`atom: true` — noteLink 是一个整体，光标不能进入内部。选中时整体选中，删除时整体删除。

---

## 三、NodeView

渲染为可点击的链接样式：

```
📄 线性代数笔记     ← 点击跳转到目标 NoteFile
```

- 显示目标 NoteFile 的 noteTitle 文字
- 点击 → 在当前 NoteView 中打开目标 NoteFile
- 目标 NoteFile 不存在时显示红色 "未找到"

---

## 四、创建方式

- 输入 `[[` → 弹出 NoteFile 搜索面板
- 选择目标 NoteFile → 插入 noteLink
- 或输入 `[[笔记标题]]` → 自动匹配

---

## 五、与知识图谱的关系

noteLink 是知识图谱的**边**——NoteFile A 中的 noteLink 指向 NoteFile B，构成文档间的引用关系。

GraphView 可以从 noteLink 数据中提取文档关系网络。

---

## 六、BlockDef

```typescript
export const noteLinkBlock: BlockDef = {
  name: 'noteLink',
  group: 'inline',
  nodeSpec: {
    inline: true,
    group: 'inline',
    atom: true,
    attrs: {
      noteId: {},
      label: { default: '' },
    },
  },
  nodeView: noteLinkNodeView,
  capabilities: {},
  slashMenu: null,             // 通过 [[ 触发，不在 SlashMenu 中
};
```

---

## 七、设计原则

1. **atom 节点** — 整体选中/删除，不可编辑内部
2. **标题自动派生** — label 从目标 NoteFile 的 noteTitle 读取
3. **知识图谱边** — 构成文档间引用关系
