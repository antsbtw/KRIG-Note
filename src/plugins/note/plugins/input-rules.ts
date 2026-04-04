import { inputRules, InputRule } from 'prosemirror-inputrules';
import type { Schema } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';

/**
 * Markdown 输入规则
 *
 * 行首输入模式 + 空格 → 自动转换：
 * - # / ## / ### → level 1/2/3
 * - - / * → bulletList Container
 * - 1. → orderedList Container
 * - [] / [ ] / [x] → taskList Container
 * - > → blockquote Container
 * - ``` → codeBlock
 * - --- → horizontalRule
 */

/** 设置当前 textBlock 的 attrs（heading level 等） */
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

/** 将当前 textBlock 包裹进 Container 节点 */
function wrapInContainer(containerName: string) {
  return (state: any, match: any, start: number, end: number) => {
    const schema = state.schema;
    const containerType = schema.nodes[containerName];
    if (!containerType) return null;

    const $start = state.doc.resolve(start);
    const depth = $start.depth;
    const blockStart = $start.before(depth);
    const node = state.doc.nodeAt(blockStart);
    if (!node || node.type.name !== 'textBlock') return null;

    // 删除 markdown 触发文字
    let tr = state.tr.delete(start, end);

    // 重新获取 textBlock（delete 后内容可能变了）
    const updatedNode = tr.doc.nodeAt(blockStart);
    if (!updatedNode) return null;
    const updatedBlockEnd = blockStart + updatedNode.nodeSize;

    // 用 Container 包裹
    const container = containerType.create(null, [updatedNode.copy(updatedNode.content)]);
    return tr.replaceWith(blockStart, updatedBlockEnd, container);
  };
}

export function buildInputRules(schema: Schema): Plugin {
  const rules: InputRule[] = [];

  if (!schema.nodes.textBlock) return inputRules({ rules });

  // # / ## / ### → heading level
  rules.push(new InputRule(/^#\s$/, setBlockAttrs({ level: 1 })));
  rules.push(new InputRule(/^##\s$/, setBlockAttrs({ level: 2 })));
  rules.push(new InputRule(/^###\s$/, setBlockAttrs({ level: 3 })));

  // - / * → bulletList Container
  if (schema.nodes.bulletList) {
    rules.push(new InputRule(/^[-*]\s$/, wrapInContainer('bulletList')));
  }

  // 1. → orderedList Container
  if (schema.nodes.orderedList) {
    rules.push(new InputRule(/^1\.\s$/, wrapInContainer('orderedList')));
  }

  // [] / [ ] / [x] → taskList Container
  if (schema.nodes.taskList) {
    rules.push(new InputRule(/^\[\]\s$/, wrapInContainer('taskList')));
    rules.push(new InputRule(/^\[ \]\s$/, wrapInContainer('taskList')));
    rules.push(new InputRule(/^\[x\]\s$/, wrapInContainer('taskList')));
  }

  // > → blockquote Container
  if (schema.nodes.blockquote) {
    rules.push(new InputRule(/^>\s$/, wrapInContainer('blockquote')));
  }

  // ``` → codeBlock
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
