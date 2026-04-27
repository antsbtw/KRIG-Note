/**
 * 布局引擎入口。
 *
 * 副作用：import 时自动注册所有内置算法（force / grid / manual）。
 * D7-D8 阶段填充实际算法实现。
 */
export { layoutRegistry } from './registry';
export type {
  LayoutAlgorithm,
  LayoutInput,
  LayoutOutput,
} from './types';

// 自动注册内置算法（副作用 import）
import './force';
import './grid';
import './manual';
import './tree-hierarchy';
