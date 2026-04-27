/**
 * Projection 入口（B3 Layer 3）。
 *
 * 副作用：import 时自动注册 v1 内置 projection（'graph'）。
 */
export { projectionRegistry } from './registry';
export type { Projection } from './types';

import { projectionRegistry } from './registry';

// v1 仅注册 'graph' projection（= 现有渲染管线）
projectionRegistry.register({
  id: 'graph',
  label: '节点-边图',
  description: '经典节点 + 边 + label 渲染（v1.4 既有管线）',
});
