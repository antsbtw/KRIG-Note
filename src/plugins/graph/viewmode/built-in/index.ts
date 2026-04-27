/**
 * v1 内置 ViewMode 注册（spec §2.3）。
 *
 * 三种视角：
 *   force  力导节点边图（v1 默认）
 *   tree   树形层级图（按 contains 关系递归）
 *   grid   网格排布
 *
 * 三者都用 'graph' projection（v1.4 既有渲染管线）；
 * 区别仅在 layout 算法。tree projection 留 v1.5+。
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
  description: '按 contains 关系递归展开；适合看层次结构',
  layout: 'tree-hierarchy',
  projection: 'graph',
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
