/**
 * KRIG 软件领域内置物质包（v1）。
 *
 * 5 个 Point/Surface 类物质，覆盖 KRIG-Note-Concept.md 样本的所有节点：
 *   - krig-layer            L0-L5 应用层级（Application / Window / Shell / Workspace / Slot / View）
 *   - krig-shell-component  Shell 内组件（WorkspaceBar / NavSidebar / WorkspaceArea / Overlays）
 *   - krig-view             5 种 View 类型（NoteView / EBookView / WebView / ThoughtView / GraphView）
 *   - krig-concept          跨层抽象概念（LayoutMode / ViewType / NavMode / IPC ...）
 *   - krig-grouping         概念集群（Surface 类）
 *
 * 视觉风格说明：
 *   - layer: 六边形 + 深色 + 大字号 + 粗边框（"层级"的厚重感）
 *   - shell-component: 圆角矩形 + 蓝灰 + 中等大小（"组件"的容器感）
 *   - view: 圆 + 蓝色 + 白字（"视图"的活跃感）
 *   - concept: 圆 + 灰色 + 浅文字（"概念"的抽象感）
 *   - grouping: 半透明灰底 + 虚线边（"圈起来"的集合感）
 */
import { substanceLibrary } from '../registry';

// ── L0-L5 应用层级（最高抽象，画图时位居核心位置） ──
substanceLibrary.register({
  id: 'krig-layer',
  label: 'KRIG 层级',
  description: 'L0-L5 应用结构层级（Application / Window / Shell / Workspace / Slot / View）',
  applies_to_kinds: ['point'],
  visual: {
    shape: 'hexagon',
    fill: { color: '#1a1a1a', opacity: 0.92 },
    border: { color: '#888', width: 3, style: 'solid' },
    text: { color: '#ffffff', size: 16, weight: 600 },
    size: { width: 84, height: 84 },
    labelLayout: 'inside-center',  // 六边形够大，label 在内部
  },
});

// ── Shell 内组件 ──
substanceLibrary.register({
  id: 'krig-shell-component',
  label: 'Shell 组件',
  description: 'Shell 骨架内的组件（WorkspaceBar / NavSidebar / WorkspaceArea / Overlays）',
  applies_to_kinds: ['point'],
  visual: {
    shape: 'rounded-rect',
    fill: { color: '#2a4a6a', opacity: 0.9 },
    border: { color: '#4a7aaa', width: 2, style: 'solid' },
    text: { color: '#e8eaed', size: 13, weight: 500 },
    size: { width: 100, height: 56 },
    labelLayout: 'inside-center',  // 矩形装得下，label 在内部
  },
});

// ── 5 种 View 类型 ──
substanceLibrary.register({
  id: 'krig-view',
  label: 'KRIG View',
  description: '内容视图（NoteView / EBookView / WebView / ThoughtView / GraphView）',
  applies_to_kinds: ['point'],
  visual: {
    shape: 'circle',
    fill: { color: '#3b82f6', opacity: 0.92 },
    border: { color: '#60a5fa', width: 2, style: 'solid' },
    text: { color: '#ffffff', size: 13, weight: 500 },
    size: { width: 72, height: 72 },
    labelLayout: 'below-center',  // 圆装不下复杂 label，下方
    labelMargin: 16,
  },
});

// ── 跨层抽象概念 ──
substanceLibrary.register({
  id: 'krig-concept',
  label: '抽象概念',
  description: '跨层抽象（LayoutMode / ViewType / NavMode / ApplicationMenu / IPC ...）',
  applies_to_kinds: ['point'],
  visual: {
    shape: 'circle',
    fill: { color: '#666', opacity: 0.85 },
    border: { color: '#999', width: 1, style: 'dashed' },
    text: { color: '#ddd', size: 12, weight: 400 },
    size: { width: 60, height: 60 },
    labelLayout: 'below-center',
    labelMargin: 14,
  },
});

// ── 概念集群（Surface） ──
substanceLibrary.register({
  id: 'krig-grouping',
  label: '概念集群',
  description: '把多个相关概念围成集合（如"View 类型族"包含 5 种 View）',
  applies_to_kinds: ['surface'],
  visual: {
    fill: { color: '#444', opacity: 0.15 },
    border: { color: '#888', width: 2, style: 'dashed' },
    text: { color: '#aaa', size: 11, weight: 400 },
    labelLayout: 'above-center',  // Surface 标题在上方
    labelMargin: 12,
  },
});

// ── 演示 layout 用的临时 substance（B1 demo 专用，展示 inside-top / left-of / right-of） ──
//   这些不是真实 KRIG 领域物质，仅为视觉对照表展示 6 种 LabelLayout

substanceLibrary.register({
  id: 'demo-card',
  label: '卡片节点',
  description: 'Demo: inside-top label（标题在内部顶部，下面留空）',
  applies_to_kinds: ['point'],
  visual: {
    shape: 'rounded-rect',
    fill: { color: '#3a3a4a', opacity: 0.9 },
    border: { color: '#7a7a9a', width: 1, style: 'solid' },
    text: { color: '#ffffff', size: 12, weight: 500 },
    size: { width: 120, height: 80 },
    labelLayout: 'inside-top',
    labelMargin: 10,
  },
});

substanceLibrary.register({
  id: 'demo-above',
  label: '上方标题',
  description: 'Demo: above-center label（label 在 shape 上方）',
  applies_to_kinds: ['point'],
  visual: {
    shape: 'circle',
    fill: { color: '#f59e0b', opacity: 0.9 },
    border: { color: '#fbbf24', width: 1, style: 'solid' },
    text: { color: '#ddd', size: 12, weight: 400 },
    size: { width: 60, height: 60 },
    labelLayout: 'above-center',
    labelMargin: 12,
  },
});

substanceLibrary.register({
  id: 'demo-left',
  label: '左侧标注',
  description: 'Demo: left-of label（label 在 shape 左侧）',
  applies_to_kinds: ['point'],
  visual: {
    shape: 'circle',
    fill: { color: '#a855f7', opacity: 0.9 },
    border: { color: '#c084fc', width: 1, style: 'solid' },
    text: { color: '#ddd', size: 12, weight: 400 },
    size: { width: 60, height: 60 },
    labelLayout: 'left-of',
    labelMargin: 12,
  },
});

substanceLibrary.register({
  id: 'demo-right',
  label: '右侧标注',
  description: 'Demo: right-of label（label 在 shape 右侧）',
  applies_to_kinds: ['point'],
  visual: {
    shape: 'circle',
    fill: { color: '#10b981', opacity: 0.9 },
    border: { color: '#34d399', width: 1, style: 'solid' },
    text: { color: '#ddd', size: 12, weight: 400 },
    size: { width: 60, height: 60 },
    labelLayout: 'right-of',
    labelMargin: 12,
  },
});
