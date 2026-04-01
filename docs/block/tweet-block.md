# tweetBlock — 推文嵌入

> **类型**：Block（叶子，可升级为 Tab Container）
> **位置**：文档中任意位置
> **状态**：待实现

---

## 一、定义

tweetBlock 是社交媒体内容嵌入——显示 Tweet/帖子的预览 + 可选图说。

属于 **EmbedBlock 模式**（外部资源嵌入）——和 image、video 是同一类：URL/ID + 元数据 + 预览。

---

## 二、Schema

```typescript
nodeSpec: {
  content: 'paragraph',          // caption
  group: 'block',
  attrs: {
    tweetUrl: { default: null },
    author: { default: '' },
    text: { default: '' },
  },
}
```

---

## 三、未来升级路径

Tab Container 升级：
```
[Preview] [Data] [Translation]
  嵌入预览  / 结构化数据  / 翻译
```

---

## 四、BlockDef

```typescript
export const tweetBlockBlock: BlockDef = {
  name: 'tweetBlock',
  group: 'block',
  nodeSpec: {
    content: 'paragraph',
    group: 'block',
    attrs: {
      tweetUrl: { default: null },
      author: { default: '' },
      text: { default: '' },
    },
  },
  nodeView: tweetBlockNodeView,
  capabilities: {
    canDelete: true,
    canDrag: true,
  },
  slashMenu: {
    label: 'Tweet',
    icon: '🐦',
    group: 'media',
    keywords: ['tweet', 'twitter', 'social', 'embed'],
    order: 3,
  },
};
```

---

## 五、设计原则

1. **EmbedBlock 模式** — 和 image/video/audio 是同一模式（URL + 预览 + caption）
2. **caption 是 paragraph** — 支持 inline 格式化
3. **Tab Container 升级** — 预览/数据/翻译作为面板
