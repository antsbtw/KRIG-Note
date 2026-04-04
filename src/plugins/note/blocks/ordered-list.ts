import type { BlockDef, NodeViewFactory } from '../types';

/**
 * orderedList — 有序列表（ContainerBlock）
 *
 * Container：block+ 子节点。
 * 为每个直接子 textBlock 渲染编号标记（1. 2. 3. 自动递增）。
 * 嵌套层级：数字 → 字母 → 罗马。
 */

const orderedListNodeView: NodeViewFactory = (node, view, getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('ordered-list');

  const contentDOM = document.createElement('div');
  contentDOM.classList.add('ordered-list__content');

  // CSS counter 实现自动编号
  dom.style.counterReset = `ordered-item ${(node.attrs.start as number) - 1}`;
  dom.appendChild(contentDOM);

  return {
    dom,
    contentDOM,
    update(updatedNode) {
      if (updatedNode.type.name !== 'orderedList') return false;
      dom.style.counterReset = `ordered-item ${(updatedNode.attrs.start as number) - 1}`;
      return true;
    },
    ignoreMutation() { return false; },
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
    toDOM(node) {
      return ['div', { class: 'ordered-list', style: `counter-reset: ordered-item ${(node.attrs.start as number) - 1}` }, 0];
    },
  },

  nodeView: orderedListNodeView,

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
    label: 'Numbered List',
    icon: '1.',
    group: 'basic',
    keywords: ['list', 'number', 'ol', 'ordered', '有序'],
    order: 6,
  },
};
