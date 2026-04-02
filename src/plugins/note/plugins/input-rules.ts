import { inputRules, InputRule } from 'prosemirror-inputrules';
import type { Schema } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';

/**
 * Markdown 输入规则
 *
 * 在行首输入特定模式 + 空格，自动转换为对应 Block：
 * - # / ## / ### → heading 1/2/3
 * - - / * → bulletList
 * - 1. → orderedList
 * - [] / [ ] → taskList（未勾选）
 * - [x] → taskList（已勾选）
 * - > → blockquote
 * - ``` → codeBlock
 * - --- → horizontalRule
 */

export function buildInputRules(schema: Schema): Plugin {
  const rules: InputRule[] = [];

  // # heading 1
  if (schema.nodes.heading) {
    rules.push(new InputRule(/^#\s$/, (state, match, start, end) => {
      return state.tr.delete(start, end).setBlockType(start, start, schema.nodes.heading, { level: 1 });
    }));
    rules.push(new InputRule(/^##\s$/, (state, match, start, end) => {
      return state.tr.delete(start, end).setBlockType(start, start, schema.nodes.heading, { level: 2 });
    }));
    rules.push(new InputRule(/^###\s$/, (state, match, start, end) => {
      return state.tr.delete(start, end).setBlockType(start, start, schema.nodes.heading, { level: 3 });
    }));
  }

  // - / * → bulletList
  if (schema.nodes.bulletList && schema.nodes.listItem) {
    rules.push(new InputRule(/^[-*]\s$/, (state, match, start, end) => {
      const listItem = schema.nodes.listItem.create(null, [schema.nodes.paragraph.create()]);
      const list = schema.nodes.bulletList.create(null, [listItem]);
      const $start = state.doc.resolve(start);
      const blockStart = $start.before(1);
      const blockEnd = $start.after(1);
      return state.tr.replaceWith(blockStart, blockEnd, list);
    }));
  }

  // 1. → orderedList
  if (schema.nodes.orderedList && schema.nodes.listItem) {
    rules.push(new InputRule(/^1\.\s$/, (state, match, start, end) => {
      const listItem = schema.nodes.listItem.create(null, [schema.nodes.paragraph.create()]);
      const list = schema.nodes.orderedList.create(null, [listItem]);
      const $start = state.doc.resolve(start);
      const blockStart = $start.before(1);
      const blockEnd = $start.after(1);
      return state.tr.replaceWith(blockStart, blockEnd, list);
    }));
  }

  // [] / [ ] → taskList（未勾选）
  if (schema.nodes.taskList && schema.nodes.taskItem) {
    rules.push(new InputRule(/^\[\]\s$/, (state, match, start, end) => {
      const taskItem = schema.nodes.taskItem.create({ checked: false }, [schema.nodes.paragraph.create()]);
      const list = schema.nodes.taskList.create(null, [taskItem]);
      const $start = state.doc.resolve(start);
      const blockStart = $start.before(1);
      const blockEnd = $start.after(1);
      return state.tr.replaceWith(blockStart, blockEnd, list);
    }));
    // [ ] with space inside
    rules.push(new InputRule(/^\[ \]\s$/, (state, match, start, end) => {
      const taskItem = schema.nodes.taskItem.create({ checked: false }, [schema.nodes.paragraph.create()]);
      const list = schema.nodes.taskList.create(null, [taskItem]);
      const $start = state.doc.resolve(start);
      const blockStart = $start.before(1);
      const blockEnd = $start.after(1);
      return state.tr.replaceWith(blockStart, blockEnd, list);
    }));
    // [x] → taskList（已勾选）
    rules.push(new InputRule(/^\[x\]\s$/, (state, match, start, end) => {
      const taskItem = schema.nodes.taskItem.create({ checked: true }, [schema.nodes.paragraph.create()]);
      const list = schema.nodes.taskList.create(null, [taskItem]);
      const $start = state.doc.resolve(start);
      const blockStart = $start.before(1);
      const blockEnd = $start.after(1);
      return state.tr.replaceWith(blockStart, blockEnd, list);
    }));
  }

  // > → blockquote
  if (schema.nodes.blockquote) {
    rules.push(new InputRule(/^>\s$/, (state, match, start, end) => {
      const para = schema.nodes.paragraph.create();
      const quote = schema.nodes.blockquote.create(null, [para]);
      const $start = state.doc.resolve(start);
      const blockStart = $start.before(1);
      const blockEnd = $start.after(1);
      return state.tr.replaceWith(blockStart, blockEnd, quote);
    }));
  }

  // ``` → codeBlock
  if (schema.nodes.codeBlock) {
    rules.push(new InputRule(/^```$/, (state, match, start, end) => {
      const codeBlock = schema.nodes.codeBlock.create();
      const $start = state.doc.resolve(start);
      const blockStart = $start.before(1);
      const blockEnd = $start.after(1);
      return state.tr.replaceWith(blockStart, blockEnd, codeBlock);
    }));
  }

  // --- → horizontalRule
  if (schema.nodes.horizontalRule) {
    rules.push(new InputRule(/^---$/, (state, match, start, end) => {
      const hr = schema.nodes.horizontalRule.create();
      const para = schema.nodes.paragraph.create();
      const $start = state.doc.resolve(start);
      const blockStart = $start.before(1);
      const blockEnd = $start.after(1);
      return state.tr.replaceWith(blockStart, blockEnd, [hr, para]);
    }));
  }

  return inputRules({ rules });
}
