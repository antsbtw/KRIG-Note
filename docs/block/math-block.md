# mathBlock — 行间数学公式

> **类型**：RenderBlock（见 `base/render-block.md`）
> **位置**：文档中任意位置
> **状态**：待实现

---

## 一、定义

mathBlock 是行间数学公式——LaTeX 输入，KaTeX 渲染。独占一行，居中显示。

```
$$
E = mc^2
$$
```

---

## 二、Schema

```typescript
nodeSpec: {
  content: 'text*',
  group: 'block',
  code: true,                  // 代码模式（等宽字体输入）
  marks: '',                   // 不支持 Mark
  attrs: {
    latex: { default: '' },    // LaTeX 源码
  },
}
```

---

## 三、NodeView

双模式显示：

- **编辑模式**：显示 LaTeX 源码（等宽字体）
- **预览模式**：KaTeX 渲染结果（居中显示）

点击公式 → 进入编辑模式。点击外部 → 回到预览模式。

---

## 四、Capabilities

```typescript
capabilities: {
  turnInto: ['paragraph'],
  canDelete: true,
  canDrag: true,
}
```

---

## 五、SlashMenu

```typescript
slashMenu: {
  label: 'Math Block',
  icon: '∑',
  group: 'math',
  keywords: ['math', 'equation', 'formula', 'latex', 'katex'],
  order: 0,
}
```

### Markdown 快捷输入

`$$` + Enter → 创建 mathBlock。

---

## 六、未来升级路径

### Tab Container 升级

```
[公式] [推导] [可视化]
  E = mc²  /  推导过程...  /  函数图像
```

---

## 七、BlockDef

```typescript
export const mathBlockBlock: BlockDef = {
  name: 'mathBlock',
  group: 'block',
  nodeSpec: {
    content: 'text*',
    group: 'block',
    code: true,
    marks: '',
    attrs: { latex: { default: '' } },
  },
  nodeView: mathBlockNodeView,
  capabilities: {
    turnInto: ['paragraph'],
    canDelete: true,
    canDrag: true,
  },
  enterBehavior: {
    action: 'newline',
    exitCondition: 'double-enter',
  },
  slashMenu: {
    label: 'Math Block',
    icon: '∑',
    group: 'math',
    keywords: ['math', 'equation', 'formula', 'latex', 'katex'],
    order: 0,
  },
};
```
