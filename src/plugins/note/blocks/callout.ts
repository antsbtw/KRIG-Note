import type { BlockDef, NodeViewFactory } from '../types';

/**
 * callout — 提示框
 *
 * Container：block+ 子节点。
 * 左侧 emoji 图标，右侧内容区域。
 * emoji 可点击切换（未来接入 emoji picker）。
 */

const EMOJI_LIST = ['💡', '⚠️', '❌', '✅', 'ℹ️', '🔥', '📌', '💬', '🎯', '⭐'];

const calloutNodeView: NodeViewFactory = (node, view, getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('callout');

  const emojiEl = document.createElement('span');
  emojiEl.classList.add('callout__emoji');
  emojiEl.textContent = node.attrs.emoji || '💡';
  // 点击循环切换 emoji
  emojiEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos == null) return;
    const currentIndex = EMOJI_LIST.indexOf(node.attrs.emoji);
    const nextIndex = (currentIndex + 1) % EMOJI_LIST.length;
    const tr = view.state.tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      emoji: EMOJI_LIST[nextIndex],
    });
    view.dispatch(tr);
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

  enterBehavior: {
    action: 'split',
    exitCondition: 'empty-enter',
  },

  capabilities: {
    turnInto: ['paragraph'],
    canDelete: true,
    canDrag: true,
  },

  containerRule: {},

  slashMenu: {
    label: 'Callout',
    icon: '💡',
    group: 'basic',
    keywords: ['callout', 'note', 'warning', 'tip', 'important', 'alert'],
    order: 11,
  },
};
