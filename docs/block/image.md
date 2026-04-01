# image — 图片

> **类型**：Block（叶子，可升级为 Tab Container）
> **位置**：文档中任意位置
> **状态**：待实现

---

## 一、定义

image 是图片 Block——显示图片 + 可选的图说（caption）。

```
┌──────────────────────────┐
│                          │
│       [图片内容]          │
│                          │
├──────────────────────────┤
│ 图说文字（可选）          │
└──────────────────────────┘
```

---

## 二、Schema

```typescript
nodeSpec: {
  content: 'paragraph',          // caption（图说）
  group: 'block',
  attrs: {
    src: { default: null },       // 图片 URL 或本地路径
    alt: { default: '' },         // alt 文字
    width: { default: null },     // 显示宽度（null = 自适应）
    height: { default: null },
  },
}
```

### content 说明

`paragraph`——图说是一个 paragraph，支持 inline 格式化（bold/italic/link）。图片本身由 NodeView 渲染（不在 ProseMirror 文档模型中）。

---

## 三、NodeView

image 需要自定义 NodeView：

```
┌─ image NodeView ─────────────────┐
│ [图片 <img>]（渲染型，NodeView 控制）│
│ contentDOM → paragraph（caption）  │
└──────────────────────────────────┘
```

- 图片通过 `<img src>` 渲染
- 图片可拖拽调整大小（宽度）
- 图片点击可选中（蓝色边框）
- caption 是 ProseMirror 管理的 paragraph

---

## 四、Capabilities

```typescript
capabilities: {
  turnInto: [],                   // 图片不能转为其他类型
  marks: [],
  canDelete: true,
  canDrag: true,
}
```

---

## 五、SlashMenu

```typescript
slashMenu: {
  label: 'Image',
  icon: '🖼',
  group: 'media',
  keywords: ['image', 'picture', 'photo', 'img'],
  order: 0,
}
```

### 创建方式

- SlashMenu 选择 Image → 弹出上传/URL 输入
- 拖拽图片文件到编辑器 → 自动创建 image Block
- 粘贴剪贴板中的图片 → 自动创建 image Block

---

## 六、未来升级路径

### 6.1 图片大小调整

拖拽右下角手柄调整宽度，高度按比例缩放。

### 6.2 Tab Container 升级

image 升级为 Tab Container：
```
[图片] [AI 分析] [标注]
┌──────────────────────┐
│ 原始图片 / AI 描述 / 标注层 │
└──────────────────────┘
图说文字
```

### 6.3 图片对齐

attrs 增加 `align`：`'left' | 'center' | 'right' | 'full'`

---

## 七、BlockDef

```typescript
export const imageBlock: BlockDef = {
  name: 'image',
  group: 'block',
  nodeSpec: {
    content: 'paragraph',
    group: 'block',
    attrs: {
      src: { default: null },
      alt: { default: '' },
      width: { default: null },
      height: { default: null },
    },
  },
  nodeView: imageNodeView,
  capabilities: {
    turnInto: [],
    canDelete: true,
    canDrag: true,
  },
  slashMenu: {
    label: 'Image',
    icon: '🖼',
    group: 'media',
    keywords: ['image', 'picture', 'photo', 'img'],
    order: 0,
  },
};
```

---

## 八、设计原则

1. **caption 是 paragraph**——图说支持 inline 格式化，不是纯文本 attr
2. **图片由 NodeView 渲染**——不在 ProseMirror 文档模型中
3. **Tab Container 升级**——AI 分析、标注作为额外面板
