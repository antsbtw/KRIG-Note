import type { BlockDef, NodeViewFactory } from '../types';

/**
 * orderedList — 有序列表（ContainerBlock）
 *
 * content: 'block+'，编号通过 CSS counter 自动递增。
 */

const orderedListNodeView: NodeViewFactory = (node, view, getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('ordered-list');
  dom.style.counterReset = `ordered-item ${(node.attrs.start as number) - 1}`;

  const contentDOM = document.createElement('div');
  contentDOM.classList.add('ordered-list__content');
  dom.appendChild(contentDOM);

  return {
    dom,
    contentDOM,
    update(updatedNode) {
      if (updatedNode.type.name !== 'orderedList') return false;
      dom.style.counterReset = `ordered-item ${(updatedNode.attrs.start as number) - 1}`;
      return true;
    },
  };
};

export const orderedListBlock: BlockDef = {
  name: 'orderedList',
  group: 'block',
  nodeSpec: {
    content: 'block+',
    group: 'block',
    defining: true,
    attrs: { start: { default: 1 } },
    parseDOM: [{ tag: 'ol' }, { tag: 'div.ordered-list' }],
    toDOM(node) { return ['div', { class: 'ordered-list', style: `counter-reset: ordered-item ${(node.attrs.start as number) - 1}` }, 0]; },
  },
  nodeView: orderedListNodeView,
  capabilities: { turnInto: ['textBlock'], canDelete: true, canDrag: true },
  containerRule: {},
  slashMenu: { label: 'Numbered List', icon: '1.', group: 'basic', keywords: ['list', 'number', 'ol', '有序'], order: 6 },
};
