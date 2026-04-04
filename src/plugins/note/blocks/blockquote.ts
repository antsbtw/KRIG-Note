import type { BlockDef, NodeViewFactory } from '../types';

/**
 * blockquote — 引用（ContainerBlock）
 *
 * Container：block+ 子节点。
 * 左侧竖线装饰，自然延伸到所有子内容。
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
    update(updatedNode) {
      return updatedNode.type.name === 'blockquote';
    },
    ignoreMutation() { return false; },
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

  enterBehavior: {
    action: 'split',
    exitCondition: 'empty-enter',
  },

  capabilities: {
    turnInto: ['textBlock'],
    canDuplicate: true,
    canDelete: true,
    canDrag: true,
  },

  containerRule: {},

  slashMenu: {
    label: 'Quote',
    icon: '❝',
    group: 'basic',
    keywords: ['quote', 'blockquote', 'cite', '引用'],
    order: 8,
  },
};
