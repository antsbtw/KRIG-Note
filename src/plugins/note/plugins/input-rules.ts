import { inputRules, InputRule } from 'prosemirror-inputrules';
import type { Schema } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';

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
    return tr.replaceWith(blockStart, updatedBlockEnd, container);
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

  return inputRules({ rules });
}
