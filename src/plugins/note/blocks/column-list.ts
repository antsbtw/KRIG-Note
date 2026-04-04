import type { BlockDef, NodeViewFactory } from '../types';

/**
 * columnList + column — 多列布局（ContainerBlock）
 *
 * columnList 包含 2-3 个 column，每个 column 包含 block+。
 */

const columnListNodeView: NodeViewFactory = (node) => {
  const dom = document.createElement('div');
  dom.classList.add('column-list');
  dom.style.setProperty('--columns', String(node.attrs.columns || 2));

  const contentDOM = document.createElement('div');
  contentDOM.classList.add('column-list__content');
  dom.appendChild(contentDOM);

  return {
    dom,
    contentDOM,
    update(updatedNode) {
      if (updatedNode.type.name !== 'columnList') return false;
      dom.style.setProperty('--columns', String(updatedNode.attrs.columns || 2));
      return true;
    },
  };
};

const columnNodeView: NodeViewFactory = () => {
  const dom = document.createElement('div');
  dom.classList.add('column');

  const contentDOM = document.createElement('div');
  contentDOM.classList.add('column__content');
  dom.appendChild(contentDOM);

  return { dom, contentDOM };
};

export const columnListBlock: BlockDef = {
  name: 'columnList',
  group: 'block',
  nodeSpec: {
    content: 'column{2,3}',
    group: 'block',
    attrs: { columns: { default: 2 } },
    parseDOM: [{ tag: 'div.column-list' }],
    toDOM() { return ['div', { class: 'column-list' }, 0]; },
  },
  nodeView: columnListNodeView,
  capabilities: { turnInto: ['textBlock'], canDelete: true, canDrag: true },
  containerRule: {},
  slashMenu: { label: '2 Columns', icon: '▥', group: 'layout', keywords: ['column', 'two', '两列'], order: 2 },
};

export const columnBlock: BlockDef = {
  name: 'column',
  group: '',
  nodeSpec: {
    content: 'block+',
    parseDOM: [{ tag: 'div.column' }],
    toDOM() { return ['div', { class: 'column' }, 0]; },
  },
  nodeView: columnNodeView,
  capabilities: {},
  slashMenu: null,
};
