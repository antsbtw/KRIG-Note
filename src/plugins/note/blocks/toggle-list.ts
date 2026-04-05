import type { BlockDef, NodeViewFactory } from '../types';

/**
 * toggleList — 折叠列表（ContainerBlock）
 *
 * 首行显示折叠箭头，子内容可折叠/展开。
 * content: 'block+'，第一个子节点为折叠标题行。
 */

const toggleListNodeView: NodeViewFactory = (node, view, getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('toggle-list');
  if (node.attrs.open === false) dom.classList.add('toggle-list--closed');

  // 折叠箭头
  const arrow = document.createElement('span');
  arrow.classList.add('toggle-list__arrow');
  arrow.textContent = node.attrs.open !== false ? '▼' : '▶';
  arrow.setAttribute('contenteditable', 'false');
  arrow.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos == null) return;
    const newOpen = !node.attrs.open;
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, open: newOpen }));
  });

  const contentDOM = document.createElement('div');
  contentDOM.classList.add('toggle-list__content');

  dom.appendChild(arrow);
  dom.appendChild(contentDOM);

  return {
    dom,
    contentDOM,
    update(updatedNode) {
      if (updatedNode.type.name !== 'toggleList') return false;
      node = updatedNode;
      const isOpen = updatedNode.attrs.open !== false;
      dom.classList.toggle('toggle-list--closed', !isOpen);
      arrow.textContent = isOpen ? '▼' : '▶';
      return true;
    },
    ignoreMutation(mutation) {
      return mutation.target === arrow || arrow.contains(mutation.target as Node);
    },
  };
};

export const toggleListBlock: BlockDef = {
  name: 'toggleList',
  group: 'block',
  nodeSpec: {
    content: 'block+',
    group: 'block',
    defining: true,
    attrs: { open: { default: true } },
    parseDOM: [{ tag: 'div.toggle-list' }],
    toDOM() { return ['div', { class: 'toggle-list' }, 0]; },
  },
  nodeView: toggleListNodeView,
  capabilities: { turnInto: ['textBlock'], canDelete: true, canDrag: true },
  containerRule: {},
  slashMenu: { label: 'Toggle List', icon: '▶', group: 'basic', keywords: ['toggle', 'fold', 'collapse', '折叠'], order: 9 },
};
