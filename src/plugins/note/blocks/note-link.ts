import type { BlockDef, NodeViewFactory } from '../types';

/**
 * noteLink — 笔记链接（Inline atom）
 */

const noteLinkNodeView: NodeViewFactory = (node, view, getPos) => {
  const dom = document.createElement('span');
  dom.classList.add('note-link');
  dom.textContent = `📄 ${node.attrs.title || 'Untitled'}`;
  dom.setAttribute('contenteditable', 'false');

  dom.addEventListener('click', () => {
    const noteId = node.attrs.noteId;
    if (noteId) {
      // 通过 IPC 打开笔记（待实现）
      console.log('[NoteLink] Open note:', noteId);
    }
  });

  return {
    dom,
    update(updatedNode) {
      if (updatedNode.type.name !== 'noteLink') return false;
      dom.textContent = `📄 ${updatedNode.attrs.title || 'Untitled'}`;
      node = updatedNode;
      return true;
    },
    stopEvent() { return true; },
    ignoreMutation() { return true; },
  };
};

export const noteLinkBlock: BlockDef = {
  name: 'noteLink',
  group: 'inline',
  nodeSpec: {
    inline: true,
    group: 'inline',
    atom: true,
    attrs: { noteId: { default: '' }, title: { default: '' } },
    parseDOM: [{ tag: 'span.note-link' }],
    toDOM(node) {
      return ['span', { class: 'note-link', 'data-note-id': node.attrs.noteId }, `📄 ${node.attrs.title || 'Untitled'}`];
    },
  },
  nodeView: noteLinkNodeView,
  capabilities: {},
  slashMenu: { label: 'Link to Note', icon: '📄', group: 'basic', keywords: ['link', 'note', '笔记链接'], order: 15 },
};
