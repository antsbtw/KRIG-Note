import type { BlockDef, NodeViewFactory } from '../types';

/**
 * toggleHeading — 折叠标题（ContainerBlock）
 *
 * 首子必须是 textBlock（标题行），后续子节点可折叠/展开。
 * content: 'block+'。
 */

const toggleHeadingNodeView: NodeViewFactory = (node, view, getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('toggle-heading');
  if (node.attrs.open === false) dom.classList.add('toggle-heading--closed');

  const arrow = document.createElement('span');
  arrow.classList.add('toggle-heading__arrow');
  arrow.textContent = node.attrs.open !== false ? '▾' : '▸';
  arrow.setAttribute('contenteditable', 'false');
  arrow.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos == null) return;
    const newOpen = !node.attrs.open;
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, open: newOpen }));
  });

  const contentDOM = document.createElement('div');
  contentDOM.classList.add('toggle-heading__content');

  dom.appendChild(arrow);
  dom.appendChild(contentDOM);

  return {
    dom,
    contentDOM,
    update(updatedNode) {
      if (updatedNode.type.name !== 'toggleHeading') return false;
      node = updatedNode;
      const isOpen = updatedNode.attrs.open !== false;
      dom.classList.toggle('toggle-heading--closed', !isOpen);
      arrow.textContent = isOpen ? '▾' : '▸';
      return true;
    },
    ignoreMutation(mutation) {
      return mutation.target === arrow || arrow.contains(mutation.target as Node);
    },
  };
};

export const toggleHeadingBlock: BlockDef = {
  name: 'toggleHeading',
  group: 'block',
  nodeSpec: {
    content: 'block+',
    group: 'block',
    defining: true,
    attrs: { open: { default: true } },
    parseDOM: [{ tag: 'div.toggle-heading' }],
    toDOM() { return ['div', { class: 'toggle-heading' }, 0]; },
  },
  nodeView: toggleHeadingNodeView,
  capabilities: { turnInto: ['textBlock'], canDelete: true, canDrag: true },
  containerRule: { requiredFirstChildType: 'textBlock' },
  slashMenu: { label: 'Toggle Heading', icon: '▶', group: 'basic', keywords: ['toggle', 'heading', 'fold', '折叠标题'], order: 13 },
};
