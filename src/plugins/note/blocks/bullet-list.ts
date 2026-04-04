import type { BlockDef, NodeViewFactory } from '../types';

/**
 * bulletList — 无序列表（ContainerBlock）
 *
 * content: 'block+'，子节点标记通过 CSS ::before 渲染。
 * 嵌套层级标记：• → ◦ → ▪
 */

const bulletListNodeView: NodeViewFactory = (node, view, getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('bullet-list');

  const contentDOM = document.createElement('div');
  contentDOM.classList.add('bullet-list__content');
  dom.appendChild(contentDOM);

  return {
    dom,
    contentDOM,
    update(updatedNode) { return updatedNode.type.name === 'bulletList'; },
  };
};

export const bulletListBlock: BlockDef = {
  name: 'bulletList',
  group: 'block',
  nodeSpec: {
    content: 'block+',
    group: 'block',
    defining: true,
    parseDOM: [{ tag: 'ul' }, { tag: 'div.bullet-list' }],
    toDOM() { return ['div', { class: 'bullet-list' }, 0]; },
  },
  nodeView: bulletListNodeView,
  capabilities: { turnInto: ['textBlock'], canDelete: true, canDrag: true },
  containerRule: {},
  slashMenu: { label: 'Bullet List', icon: '•', group: 'basic', keywords: ['list', 'bullet', 'ul', '无序'], order: 5 },
};
