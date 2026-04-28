/**
 * 内置 ViewMode 注册（Pattern Spec §2.3）。
 *
 * 三种视角：
 *   force  力导节点边图（v1 默认） — ELK 'force' + 'graph' projection
 *   tree   树形层级图               — ELK 'mrtree' + 'tree' projection（直角折线）
 *   grid   网格排布                 — ELK 'box' + 'graph' projection
 */
import { viewModeRegistry } from '../registry';

viewModeRegistry.register({
  id: 'force',
  label: '力导图',
  description: '节点互相排斥 + 边吸引；适合探索关系网络',
  layout: 'force',
  projection: 'graph',
  enable_patterns: true,
});

viewModeRegistry.register({
  id: 'tree',
  label: '层级树',
  description: '按 contains 关系递归展开；边样式可在画板上切换（直线/直角/折线/曲线）',
  // B4.2：虚拟 layout `tree` 内部根据 layout.edge-style 派发到 mrtree 或 layered
  layout: 'tree',
  projection: 'tree',
  enable_patterns: true,
});

viewModeRegistry.register({
  id: 'grid',
  label: '网格',
  description: '等距网格排布；适合查看节点清单',
  layout: 'grid',
  projection: 'graph',
  enable_patterns: true,
});
