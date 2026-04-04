import { inputRules, InputRule } from 'prosemirror-inputrules';
import type { Schema } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';

/**
 * Markdown 输入规则
 *
 * 行首输入模式 + 空格 → 自动转换：
 * - # / ## / ### → level 1/2/3
 * - - / * → groupType = 'bullet'
 * - 1. → groupType = 'ordered'
 * - [] / [ ] → groupType = 'task'
 * - [x] → groupType = 'task' (checked)
 * - > → groupType = 'quote'
 * - ``` → codeBlock
 * - --- → horizontalRule
 */

/** 辅助：设置当前 textBlock 的 attrs */
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

  // - / * → bullet list
  rules.push(new InputRule(/^[-*]\s$/, setBlockAttrs({ groupType: 'bullet' })));

  // 1. → ordered list
  rules.push(new InputRule(/^1\.\s$/, setBlockAttrs({ groupType: 'ordered' })));

  // [] / [ ] → task list（未勾选）
  rules.push(new InputRule(/^\[\]\s$/, setBlockAttrs({ groupType: 'task', groupAttrs: { checked: false } })));
  rules.push(new InputRule(/^\[ \]\s$/, setBlockAttrs({ groupType: 'task', groupAttrs: { checked: false } })));

  // [x] → task list（已勾选）
  rules.push(new InputRule(/^\[x\]\s$/, setBlockAttrs({ groupType: 'task', groupAttrs: { checked: true } })));

  // > → quote
  rules.push(new InputRule(/^>\s$/, setBlockAttrs({ groupType: 'quote' })));

  // ``` → codeBlock（替换为 RenderBlock）
  if (schema.nodes.codeBlock) {
    rules.push(new InputRule(/^```$/, (state, match, start, end) => {
      const codeBlock = schema.nodes.codeBlock.create();
      const $start = state.doc.resolve(start);
      const blockStart = $start.before($start.depth);
      const blockEnd = $start.after($start.depth);
      return state.tr.replaceWith(blockStart, blockEnd, codeBlock);
    }));
  }

  // --- → horizontalRule
  if (schema.nodes.horizontalRule) {
    rules.push(new InputRule(/^---$/, (state, match, start, end) => {
      const hr = schema.nodes.horizontalRule.create();
      const newP = schema.nodes.textBlock.create();
      const $start = state.doc.resolve(start);
      const blockStart = $start.before($start.depth);
      const blockEnd = $start.after($start.depth);
      return state.tr.replaceWith(blockStart, blockEnd, [hr, newP]);
    }));
  }

  return inputRules({ rules });
}
