import type { BlockDef, NodeViewFactory } from '../types';

/**
 * blockquote — 引用（ContainerBlock）
 *
 * content: 'block+'，左侧竖线自然延伸到所有子内容。
 */

const blockquoteNodeView: NodeViewFactory = (node, view, getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('blockquote');

  const contentDOM = document.createElement('div');
  contentDOM.classList.add('blockquote__content');
  dom.appendChild(contentDOM);

  return {
    dom,
    contentDOM,
    update(updatedNode) { return updatedNode.type.name === 'blockquote'; },
  };
};

export const blockquoteBlock: BlockDef = {
  name: 'blockquote',
  group: 'block',
  nodeSpec: {
    content: 'block+',
    group: 'block',
    defining: true,
    parseDOM: [{ tag: 'blockquote' }, { tag: 'div.blockquote' }],
    toDOM() { return ['div', { class: 'blockquote' }, 0]; },
  },
  nodeView: blockquoteNodeView,
  capabilities: { turnInto: ['textBlock'], canDelete: true, canDrag: true },
  containerRule: {},
  slashMenu: { label: 'Quote', icon: '❝', group: 'basic', keywords: ['quote', 'blockquote', '引用'], order: 8 },
};
