import { inputRules, InputRule } from 'prosemirror-inputrules';
import type { Schema } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';

/**
 * Markdown 输入规则
 *
 * Phase 1：仅 heading 快捷输入
 * Phase 4：加入 Container 快捷输入（- / 1. / [] / >）
 */

function setBlockAttrs(attrsToSet: Record<string, unknown>) {
  return (state: any, match: any, start: number, end: number) => {
    const $start = state.doc.resolve(start);
    const depth = $start.depth;
    const blockStart = $start.before(depth);
    const node = state.doc.nodeAt(blockStart);
    if (!node || node.type.name !== 'textBlock') return null;
    return state.tr.delete(start, end).setNodeMarkup(blockStart, undefined, { ...node.attrs, ...attrsToSet });
  };
}

export function buildInputRules(schema: Schema): Plugin {
  const rules: InputRule[] = [];

  if (!schema.nodes.textBlock) return inputRules({ rules });

  // # / ## / ### → heading level
  rules.push(new InputRule(/^#\s$/, setBlockAttrs({ level: 1 })));
  rules.push(new InputRule(/^##\s$/, setBlockAttrs({ level: 2 })));
  rules.push(new InputRule(/^###\s$/, setBlockAttrs({ level: 3 })));

  // TODO Phase 4: Container 快捷输入（- / * / 1. / [] / > / ```）

  return inputRules({ rules });
}
