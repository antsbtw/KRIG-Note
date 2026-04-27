/**
 * Workspace Pattern 试金石 — 5 个内置 substance：
 *
 *   krig-navside    左侧导航（NavSidebar）
 *   krig-slot       中间内容槽位（WorkspaceArea / Slot）
 *   krig-ipc        底部跨层通信（IPC 提示）
 *   krig-toolbar    顶部工具栏（WorkspaceBar）
 *   pattern-workspace  ← 把上述 4 个角色组装成 workspace 范式
 *
 * 任何引用了 pattern-workspace 的容器节点 + 它通过 contains 关系连接的
 * 4 类子节点（按 substance 区分），渲染时自动按 left/center/bottom/top 槽位摆放。
 *
 * 设计依据：docs/graph/KRIG-Graph-Pattern-Spec.md §1.2 / §1.3
 *           docs/KRIG-Note-Vision.md §5.4 (用户能创造视图模式)
 */
import { substanceLibrary } from '../registry';

// ── 4 个角色子节点 substance（简单 Substance，仅 visual） ──

substanceLibrary.register({
  id: 'krig-navside',
  label: 'NavSide',
  description: 'Workspace 左侧导航栏（角色：navside）',
  applies_to_kinds: ['point'],
  visual: {
    shape: 'rounded-rect',
    fill: { color: '#3a3a5e', opacity: 0.9 },
    border: { color: '#5a5a8a', width: 2, style: 'solid' },
    text: { color: '#e8eaed', size: 13, weight: 500 },
    size: { width: 80, height: 60 },
    labelLayout: 'inside-center',
  },
});

substanceLibrary.register({
  id: 'krig-slot',
  label: 'Slot',
  description: 'Workspace 中间内容槽位（角色：slot）',
  applies_to_kinds: ['point'],
  visual: {
    shape: 'rounded-rect',
    fill: { color: '#2a4a6a', opacity: 0.9 },
    border: { color: '#4a7aaa', width: 2, style: 'solid' },
    text: { color: '#e8eaed', size: 13, weight: 500 },
    size: { width: 120, height: 80 },
    labelLayout: 'inside-center',
  },
});

substanceLibrary.register({
  id: 'krig-ipc',
  label: 'IPC',
  description: 'Workspace 跨层通信（角色：ipc，底部）',
  applies_to_kinds: ['point'],
  visual: {
    shape: 'rounded-rect',
    fill: { color: '#4a3a5e', opacity: 0.9 },
    border: { color: '#7a5a8a', width: 2, style: 'solid' },
    text: { color: '#e8eaed', size: 12, weight: 500 },
    size: { width: 80, height: 50 },
    labelLayout: 'inside-center',
  },
});

substanceLibrary.register({
  id: 'krig-toolbar',
  label: 'Toolbar',
  description: 'Workspace 顶部工具栏（角色：toolbar）',
  applies_to_kinds: ['point'],
  visual: {
    shape: 'rounded-rect',
    fill: { color: '#5e4a3a', opacity: 0.9 },
    border: { color: '#8a7a5a', width: 2, style: 'solid' },
    text: { color: '#e8eaed', size: 12, weight: 500 },
    size: { width: 80, height: 50 },
    labelLayout: 'inside-center',
  },
});

// ── Pattern Substance：pattern-workspace ──
//
// 注册到同一个 substanceLibrary（决议 1：命名空间共用）。
// roles + pattern_layout 字段让渲染管线识别为 Pattern Substance（决议 2）。
//
// 角色 required 全部 false（决议 5：默认宽容）—— 缺哪个槽位空着，仍然画 workspace。

substanceLibrary.register({
  id: 'pattern-workspace',
  label: 'KRIG Workspace 模式',
  description: 'workspace 容器 + navside / slot / ipc / toolbar 4 个角色的标准布局',
  applies_to_kinds: ['point'],

  // 容器自身视觉（外壳）
  visual: {
    shape: 'rounded-rect',
    fill: { color: '#1a1a2e', opacity: 0.85 },
    border: { color: '#4a4a8a', width: 2, style: 'solid' },
    text: { color: '#e8eaed', size: 14, weight: 600 },
    size: { width: 400, height: 300 },
    labelLayout: 'inside-top',
    labelMargin: 12,
  },

  // 角色定义
  roles: {
    navside: { via: 'contains', requires_substance: 'krig-navside', arity: 'one' },
    slot:    { via: 'contains', requires_substance: 'krig-slot',    arity: 'one' },
    ipc:     { via: 'contains', requires_substance: 'krig-ipc',     arity: 'one' },
    toolbar: { via: 'contains', requires_substance: 'krig-toolbar', arity: 'one' },
  },

  // 角色布局：命名槽位
  pattern_layout: {
    kind: 'slots',
    assignments: {
      navside: 'left',
      slot:    'center',
      ipc:     'bottom',
      toolbar: 'top',
    },
  },
});
