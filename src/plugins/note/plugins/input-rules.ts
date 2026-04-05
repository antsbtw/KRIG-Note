import { inputRules, InputRule } from 'prosemirror-inputrules';
import type { Schema } from 'prosemirror-model';
import { Plugin, TextSelection } from 'prosemirror-state';

/**
 * Markdown 输入规则
 *
 * # / ## / ### → heading level
 * - / * → bulletList Container
 * 1. → orderedList Container
 * [] / [ ] / [x] → taskList Container
 * > → blockquote Container
 */

function setBlockAttrs(attrsToSet: Record<string, unknown>) {
  return (state: any, match: any, start: number, end: number) => {
    const $start = state.doc.resolve(start);
    const blockStart = $start.before($start.depth);
    const node = state.doc.nodeAt(blockStart);
    if (!node || node.type.name !== 'textBlock') return null;
    return state.tr.delete(start, end).setNodeMarkup(blockStart, undefined, { ...node.attrs, ...attrsToSet });
  };
}

function wrapInContainer(containerName: string) {
  return (state: any, match: any, start: number, end: number) => {
    const containerType = state.schema.nodes[containerName];
    if (!containerType) return null;

    const $start = state.doc.resolve(start);
    const blockStart = $start.before($start.depth);
    const node = state.doc.nodeAt(blockStart);
    if (!node || node.type.name !== 'textBlock') return null;

    let tr = state.tr.delete(start, end);
    const updatedNode = tr.doc.nodeAt(blockStart);
    if (!updatedNode) return null;
    const updatedBlockEnd = blockStart + updatedNode.nodeSize;

    const container = containerType.create(null, [updatedNode.copy(updatedNode.content)]);
    tr.replaceWith(blockStart, updatedBlockEnd, container);
    // 光标定位到 container 内第一个子 block
    tr.setSelection(TextSelection.near(tr.doc.resolve(blockStart + 2)));
    return tr;
  };
}

export function buildInputRules(schema: Schema): Plugin {
  const rules: InputRule[] = [];
  if (!schema.nodes.textBlock) return inputRules({ rules });

  // Heading
  rules.push(new InputRule(/^#\s$/, setBlockAttrs({ level: 1 })));
  rules.push(new InputRule(/^##\s$/, setBlockAttrs({ level: 2 })));
  rules.push(new InputRule(/^###\s$/, setBlockAttrs({ level: 3 })));

  // Container shortcuts
  if (schema.nodes.bulletList) rules.push(new InputRule(/^[-*]\s$/, wrapInContainer('bulletList')));
  if (schema.nodes.orderedList) rules.push(new InputRule(/^1\.\s$/, wrapInContainer('orderedList')));
  if (schema.nodes.taskList) {
    rules.push(new InputRule(/^\[\]\s$/, wrapInContainer('taskList')));
    rules.push(new InputRule(/^\[ \]\s$/, wrapInContainer('taskList')));
    rules.push(new InputRule(/^\[x\]\s$/, wrapInContainer('taskList')));
  }
  if (schema.nodes.blockquote) rules.push(new InputRule(/^>\s$/, wrapInContainer('blockquote')));

  // ``` → codeBlock
  if (schema.nodes.codeBlock) {
    rules.push(new InputRule(/^```$/, (state: any, match: any, start: number, end: number) => {
      const $start = state.doc.resolve(start);
      const blockStart = $start.before($start.depth);
      const blockEnd = $start.after($start.depth);
      return state.tr.replaceWith(blockStart, blockEnd, schema.nodes.codeBlock.create());
    }));
  }

  // --- → horizontalRule
  if (schema.nodes.horizontalRule) {
    rules.push(new InputRule(/^---$/, (state: any, match: any, start: number, end: number) => {
      const $start = state.doc.resolve(start);
      const blockStart = $start.before($start.depth);
      const blockEnd = $start.after($start.depth);
      return state.tr.replaceWith(blockStart, blockEnd, [
        schema.nodes.horizontalRule.create(),
        schema.nodes.textBlock.create(),
      ]);
    }));
  }

  return inputRules({ rules });
}
