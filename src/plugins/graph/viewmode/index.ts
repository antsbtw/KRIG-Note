/**
 * ViewMode 入口（B3 Layer 3）。
 *
 * 副作用：import 时自动注册 v1 内置 ViewMode（force / tree / grid）。
 *
 * 详见 docs/graph/KRIG-Graph-Pattern-Spec.md §2
 */
export { viewModeRegistry } from './registry';
export type { ViewMode, GraphFilter } from './types';

// 内置 ViewMode（按依赖顺序注册）
import './built-in';
