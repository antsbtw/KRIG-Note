/**
 * Projection 入口（B3 Layer 3）。
 *
 * 副作用：import 时自动注册内置 projection。
 *   v1.7（B3.3）：'graph'
 *   v1.8（B3.4）：'tree'
 */
export { projectionRegistry } from './registry';
export type { Projection } from './types';

import { projectionRegistry } from './registry';
import { treeProjection } from './built-in/tree';

// 'graph' = 经典节点-边图（KRIG v1.4 既有管线，customizeLine 不介入）
projectionRegistry.register({
  id: 'graph',
  label: '节点-边图',
  description: '经典节点 + 边 + label 渲染（v1.4 既有管线）',
  edgeStyle: 'straight',
});

// 'tree' = ELK ORTHOGONAL 折线（B3.4）
projectionRegistry.register(treeProjection);
