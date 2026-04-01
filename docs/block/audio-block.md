# audioBlock — 音频

> **类型**：Block（叶子，可升级为 Tab Container）
> **位置**：文档中任意位置
> **状态**：待实现

---

## 一、定义

audioBlock 是音频播放器 Block——嵌入音频文件 + 可选的图说。

```
┌──────────────────────────┐
│ 🎵 [▶ ━━━━━━━━━ 03:45]   │  ← 播放器
│ 标题 / 艺术家             │
├──────────────────────────┤
│ 图说文字                  │  ← caption
└──────────────────────────┘
```

---

## 二、Schema

```typescript
nodeSpec: {
  content: 'paragraph',         // caption
  group: 'block',
  attrs: {
    src: { default: null },
    title: { default: '' },
    artist: { default: '' },
    duration: { default: 0 },
  },
}
```

---

## 三、未来升级路径

Tab Container 升级：
```
[播放器] [字幕] [笔记]
```

---

## 四、BlockDef

```typescript
export const audioBlockBlock: BlockDef = {
  name: 'audioBlock',
  group: 'block',
  nodeSpec: {
    content: 'paragraph',
    group: 'block',
    attrs: {
      src: { default: null },
      title: { default: '' },
      artist: { default: '' },
      duration: { default: 0 },
    },
  },
  nodeView: audioBlockNodeView,
  capabilities: {
    canDelete: true,
    canDrag: true,
  },
  slashMenu: {
    label: 'Audio',
    icon: '🎵',
    group: 'media',
    keywords: ['audio', 'music', 'sound', 'podcast'],
    order: 2,
  },
};
```
