/**
 * Markdown 导入解析器 — MD → ParseResult。
 *
 * 解析规则见 docs/graph/KRIG-Graph-Import-Spec.md §3-4。
 *
 * D4-D5 阶段实现实际算法。本文件 D1 仅占位。
 */
import type { GeometryKind } from '../../rendering/substance/types';
import type { IntensionValueKind } from './registries';

export interface ParsedMeta {
  title?: string;
  graph_variant?: string;
  dimension?: 2 | 3;
  folder_id?: string | null;
  active_layout?: string;
}

export interface ParsedGeometry {
  /** 解析时分配的临时 id（导入器据此创建实际记录） */
  id: string;
  kind: GeometryKind;
  /** 引用下层几何体的临时 id */
  members: string[];
}

export interface ParsedIntensionAtom {
  subject_id: string;
  predicate: string;
  value: string;
  value_kind: IntensionValueKind;
  sort_order: number;
}

export interface ParseResult {
  meta: ParsedMeta;
  geometries: ParsedGeometry[];
  intensions: ParsedIntensionAtom[];
  /** 引用了不存在的 id 等问题 */
  warnings: string[];
}

/**
 * 解析 Markdown 文本为 ParseResult。
 *
 * D4-D5 实现。当前 D1 占位。
 */
export function parseMarkdown(content: string): ParseResult {
  void content;
  return {
    meta: {},
    geometries: [],
    intensions: [],
    warnings: ['parser not implemented yet (D4-D5)'],
  };
}
