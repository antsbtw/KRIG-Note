import type { BlockDef, NodeViewFactory } from '../types';

/**
 * noteTitle — Note 文档标题
 *
 * 文档的第一个 Block，固定存在。
 * enterBehavior: exit + always → 每次 Enter 都跳到下方 paragraph。
 */

const noteTitleNodeView: NodeViewFactory = (node, _view, _getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('note-title');

  if (node.content.size === 0) {
    dom.classList.add('is-empty');
  }

  const contentDOM = document.createElement('h1');
  contentDOM.classList.add('note-title__content');
  dom.appendChild(contentDOM);

  return {
    dom,
    contentDOM,
    update(updatedNode) {
      if (updatedNode.type.name !== 'noteTitle') return false;
      dom.classList.toggle('is-empty', updatedNode.content.size === 0);
      return true;
    },
  };
};

export const noteTitleBlock: BlockDef = {
  name: 'noteTitle',
  group: '',

  nodeSpec: {
    content: 'inline*',
    marks: 'bold italic code link',
    defining: true,
    isolating: true,
    parseDOM: [{ tag: 'div.note-title' }],
    toDOM() { return ['div', { class: 'note-title' }, ['h1', { class: 'note-title__content' }, 0]]; },
  },

  nodeView: noteTitleNodeView,

  enterBehavior: {
    action: 'exit',
    exitCondition: 'always',
  },

  capabilities: {
    turnInto: [],
    marks: ['bold', 'italic', 'code', 'link'],
    canDelete: false,
    canDuplicate: false,
    canDrag: false,
  },

  slashMenu: null,
};
