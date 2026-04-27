/**
 * 关系类 Line 物质（v1 内置 5 种）。
 *
 * 解析器识别 contains / refs / routes-to / defines / links-to 等关系类 predicate 时，
 * 自动给生成的 Line 几何体打上对应的 substance 引用：
 *   contains  → relation-contains    （实线，单向箭头朝目标）
 *   refs      → relation-refs        （细虚线）
 *   routes-to → relation-routes-to   （点划线，双向箭头）
 *   defines   → relation-defines     （粗实线，三角箭头）
 *   links-to  → relation-links-to    （细实线，无箭头）
 *
 * 视觉差异让用户一眼就能区分边的类型（不需要点开属性面板）。
 */
import { substanceLibrary } from '../registry';

substanceLibrary.register({
  id: 'relation-contains',
  label: '包含关系',
  description: '父 contains 子（如 Window contains Shell）',
  applies_to_kinds: ['line'],
  visual: {
    border: { color: '#c0c0c0', width: 2, style: 'solid' },
    text: { color: '#888', size: 10 },
    labelLayout: 'below-center',
    labelMargin: 8,
    arrow: 'forward',
  },
});

substanceLibrary.register({
  id: 'relation-refs',
  label: '引用关系',
  description: '行内提及或弱引用（如"参见 [[X]]"）',
  applies_to_kinds: ['line'],
  visual: {
    border: { color: '#888', width: 1, style: 'dashed' },
    text: { color: '#666', size: 10 },
    labelLayout: 'below-center',
    labelMargin: 8,
  },
});

substanceLibrary.register({
  id: 'relation-routes-to',
  label: '通信路由',
  description: 'View 间通过 IPC 通信（如 NoteView routes-to ThoughtView）',
  applies_to_kinds: ['line'],
  visual: {
    border: { color: '#3b82f6', width: 2, style: 'dotted' },
    text: { color: '#60a5fa', size: 10 },
    labelLayout: 'below-center',
    labelMargin: 8,
    arrow: 'both',
  },
});

substanceLibrary.register({
  id: 'relation-defines',
  label: '类型定义',
  description: '抽象类型定义具体实例（如 ViewType defines NoteView）',
  applies_to_kinds: ['line'],
  visual: {
    border: { color: '#aaa', width: 3, style: 'solid' },
    text: { color: '#888', size: 10 },
    labelLayout: 'below-center',
    labelMargin: 8,
    arrow: 'forward',
    arrowSize: 14,
  },
});

substanceLibrary.register({
  id: 'relation-links-to',
  label: '一般链接',
  description: '通用链接关系（无特定语义）',
  applies_to_kinds: ['line'],
  visual: {
    border: { color: '#999', width: 1, style: 'solid' },
    text: { color: '#777', size: 10 },
    labelLayout: 'below-center',
    labelMargin: 8,
  },
});
