/**
 * AtomConverter 接口定义
 *
 * Converter 负责 ProseMirror Node ↔ Atom 的双向转换，
 * 是编辑器引擎和存储层之间的唯一桥梁。
 *
 * 设计约束：
 * - 纯函数：无副作用，相同输入永远产生相同输出
 * - 幂等：toAtom(toPM(atom)) 应等价于原 atom（Round-trip）
 * - 容错：遇到无法识别的节点类型，降级为 paragraph
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { Atom, AtomType } from '../../../shared/types/atom-types';

/** ProseMirror Node JSON（用于 Node.fromJSON） */
export interface PMNodeJSON {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNodeJSON[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

/**
 * AtomConverter — 单个 Block 的双向转换器
 *
 * 每个 BlockDef 可以声明一个 converter。
 * atomTypes 可以是多个（如 textBlock 对应 paragraph/heading/noteTitle）。
 */
export interface AtomConverter {
  /** 此 converter 处理的 AtomType（可多个） */
  atomTypes: AtomType[];

  /** 对应的 ProseMirror 节点类型名 */
  pmType: string;

  /** ProseMirror Node → Atom（可能返回多个，如容器 + 子节点） */
  toAtom(node: PMNode, parentId?: string): Atom | Atom[];

  /** Atom → ProseMirror Node JSON */
  toPM(atom: Atom, childAtoms?: Atom[]): PMNodeJSON;
}
