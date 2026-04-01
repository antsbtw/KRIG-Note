# videoPlaceholder — 视频（Tab Container）

> **类型**：Container（Tab Container 架构）
> **位置**：文档中任意位置
> **状态**：待实现

---

## 一、定义

videoPlaceholder 是视频播放 Block——天然的 Tab Container，包含多个面板。

```
[Video] [Meta] [Subtitle] [ZH-CN]   CC ⬇️ ⛶
┌──────────────────────────────────────┐
│                                      │
│          视频播放器 (16:9)            │  ← 渲染型面板
│                                      │
├──────────────────────────────────────┤
│ caption 文字                         │  ← 编辑型面板（始终可见）
└──────────────────────────────────────┘
```

---

## 二、Schema

```typescript
nodeSpec: {
  content: 'tabPane+',              // Tab 面板
  group: 'block',
  attrs: {
    src: { default: null },          // 视频 URL
    metadata: { default: '{}' },     // yt-dlp 元数据 JSON
  },
}
```

---

## 三、Tab 面板

| Tab | 类型 | 内容 |
|-----|------|------|
| Video | 渲染型 | 视频播放器（iframe 或 HTML5 video） |
| Meta | 渲染型 | 元数据卡片（标题、描述、频道、时长） |
| Subtitle | 编辑型 (tabPane) | 原始字幕（可编辑） |
| ZH-CN | 编辑型 (tabPane) | 翻译字幕（动态添加） |
| caption | 编辑型 (tabPane) | 图说（始终可见） |

---

## 四、Tab Container 基础设施

videoPlaceholder 是 Tab Container 的**典型用例**——验证 `tabs` 声明 + `tabPane` 共享基础设施。

```typescript
tabs: [
  { id: 'video', label: 'Video', type: 'rendered' },
  { id: 'meta', label: 'Meta', type: 'rendered' },
  { id: 'subtitle', label: 'Subtitle', type: 'editable' },
],
```

---

## 五、BlockDef

```typescript
export const videoBlock: BlockDef = {
  name: 'videoPlaceholder',
  group: 'block',
  nodeSpec: {
    content: 'tabPane+',
    group: 'block',
    attrs: {
      src: { default: null },
      metadata: { default: '{}' },
    },
  },
  nodeView: videoNodeView,
  tabs: [
    { id: 'video', label: 'Video', type: 'rendered' },
    { id: 'meta', label: 'Meta', type: 'rendered' },
    { id: 'subtitle', label: 'Subtitle', type: 'editable' },
  ],
  capabilities: {
    canDelete: true,
    canDrag: true,
  },
  slashMenu: {
    label: 'Video',
    icon: '🎬',
    group: 'media',
    keywords: ['video', 'youtube', 'movie'],
    order: 1,
  },
};
```
