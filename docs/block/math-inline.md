# mathInline — 行内数学公式

> **类型**：Inline 节点（atom）
> **位置**：任何接受 inline 内容的 Block 内部
> **状态**：待实现

---

## 一、定义

mathInline 是行内数学公式——在文字中嵌入小公式，不独占一行。

```
根据公式 $E = mc^2$，质量和能量可以互换。
```

---

## 二、Schema

```typescript
nodeSpec: {
  inline: true,
  group: 'inline',
  atom: true,
  attrs: {
    latex: { default: '' },
  },
}
```

---

## 三、NodeView

- 预览模式：KaTeX 渲染的行内公式
- 点击 → 弹出编辑框（输入 LaTeX）
- 输入 `$...$` 自动创建

---

## 四、BlockDef

```typescript
export const mathInlineBlock: BlockDef = {
  name: 'mathInline',
  group: 'inline',
  nodeSpec: {
    inline: true,
    group: 'inline',
    atom: true,
    attrs: { latex: { default: '' } },
  },
  nodeView: mathInlineNodeView,
  capabilities: {},
  slashMenu: null,
};
```
