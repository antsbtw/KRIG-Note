import type { BlockDef, NodeViewFactory } from '../types';

/**
 * columnList + column — 多列布局
 *
 * columnList > column+ (2-3 列)
 * 每个 column 包含 block+（可嵌入任意 Block）
 */

// ── columnList NodeView ──

const columnListNodeView: NodeViewFactory = (node) => {
  const dom = document.createElement('div');
  dom.classList.add('column-list');
  dom.style.setProperty('--column-count', String(node.attrs.columns || 2));

  const contentDOM = document.createElement('div');
  contentDOM.classList.add('column-list__content');
  dom.appendChild(contentDOM);

  return {
    dom,
    contentDOM,
    update(updatedNode) {
      if (updatedNode.type.name !== 'columnList') return false;
      dom.style.setProperty('--column-count', String(updatedNode.attrs.columns || 2));
      return true;
    },
  };
};

// ── column NodeView ──

const columnNodeView: NodeViewFactory = () => {
  const dom = document.createElement('div');
  dom.classList.add('column');

  const contentDOM = document.createElement('div');
  contentDOM.classList.add('column__content');
  dom.appendChild(contentDOM);

  return {
    dom,
    contentDOM,
  };
};

// ── BlockDef ──

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

  capabilities: {
    turnInto: ['paragraph'],
    canDelete: true,
    canDrag: true,
  },

  containerRule: {},

  slashMenu: {
    label: '2 Columns',
    icon: '▥',
    group: 'layout',
    keywords: ['column', 'split', 'side', 'layout', '分栏', '两列'],
    order: 0,
  },
};

export const columnBlock: BlockDef = {
  name: 'column',
  group: '',  // 不属于 block 组，只在 columnList 内

  nodeSpec: {
    content: 'block+',
    parseDOM: [{ tag: 'div.column' }],
    toDOM() { return ['div', { class: 'column' }, 0]; },
  },

  nodeView: columnNodeView,

  capabilities: {},

  slashMenu: null,
};
