/**
 * Substance Library 入口。
 *
 * 副作用：import 时自动注册所有 built-in 物质。
 */
export { substanceLibrary } from './registry';
export type {
  Substance,
  SubstanceVisual,
  SubstancePhysical,
  SubstanceChemical,
  SubstanceBehavior,
  GeometryKind,
  // B3 Pattern 扩展
  RoleSelector,
  SlotPosition,
  PatternLayout,
} from './types';

// 自动注册内置物质（D3 阶段填充）
import './built-in/krig-software-domain';
import './built-in/relations';
// B3 Pattern 试金石（B3.2）
import './built-in/krig-workspace-roles';
