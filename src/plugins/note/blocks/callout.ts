import type { BlockDef, NodeViewFactory } from '../types';

/**
 * callout — 提示框（ContainerBlock）
 *
 * content: 'block+'，emoji + 背景色包裹所有子内容。
 */

const EMOJI_LIST = ['💡', '⚠️', '❌', '✅', 'ℹ️', '🔥', '📌', '💬', '🎯', '⭐'];

const calloutNodeView: NodeViewFactory = (node, view, getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('callout');

  const emojiEl = document.createElement('span');
  emojiEl.classList.add('callout__emoji');
  emojiEl.textContent = node.attrs.emoji || '💡';
  emojiEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos == null) return;
    const idx = EMOJI_LIST.indexOf(node.attrs.emoji);
    const next = (idx + 1) % EMOJI_LIST.length;
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, emoji: EMOJI_LIST[next] }));
  });

  const contentDOM = document.createElement('div');
  contentDOM.classList.add('callout__content');

  dom.appendChild(emojiEl);
  dom.appendChild(contentDOM);

  return {
    dom,
    contentDOM,
    update(updatedNode) {
      if (updatedNode.type.name !== 'callout') return false;
      emojiEl.textContent = updatedNode.attrs.emoji || '💡';
      node = updatedNode;
      return true;
    },
    ignoreMutation(mutation) {
      return mutation.target === emojiEl || emojiEl.contains(mutation.target as Node);
    },
  };
};

export const calloutBlock: BlockDef = {
  name: 'callout',
  group: 'block',
  nodeSpec: {
    content: 'block+',
    group: 'block',
    attrs: { emoji: { default: '💡' } },
    parseDOM: [{ tag: 'div.callout' }],
    toDOM() { return ['div', { class: 'callout' }, 0]; },
  },
  nodeView: calloutNodeView,
  capabilities: { turnInto: ['textBlock'], canDelete: true, canDrag: true },
  containerRule: {},
  slashMenu: { label: 'Callout', icon: '💡', group: 'basic', keywords: ['callout', 'tip', 'warning', '提示'], order: 11 },
};
