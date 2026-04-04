import type { BlockDef, NodeViewFactory } from '../types';

/**
 * frameBlock — 彩框（ContainerBlock）
 *
 * content: 'block+'，彩色左边框。
 */

const COLORS = ['#8ab4f8', '#f28b82', '#81c995', '#fdd663', '#c58af9', '#78d9ec'];

const frameBlockNodeView: NodeViewFactory = (node, view, getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('frame-block');
  dom.style.setProperty('--frame-color', node.attrs.color || COLORS[0]);

  // 左边框可点击切换颜色
  const border = document.createElement('div');
  border.classList.add('frame-block__border');
  border.setAttribute('contenteditable', 'false');
  border.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos == null) return;
    const idx = COLORS.indexOf(node.attrs.color);
    const next = COLORS[(idx + 1) % COLORS.length];
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, color: next }));
  });

  const contentDOM = document.createElement('div');
  contentDOM.classList.add('frame-block__content');

  dom.appendChild(border);
  dom.appendChild(contentDOM);

  return {
    dom,
    contentDOM,
    update(updatedNode) {
      if (updatedNode.type.name !== 'frameBlock') return false;
      node = updatedNode;
      dom.style.setProperty('--frame-color', updatedNode.attrs.color || COLORS[0]);
      return true;
    },
    ignoreMutation(mutation) {
      return mutation.target === border || border.contains(mutation.target as Node);
    },
  };
};

export const frameBlockBlock: BlockDef = {
  name: 'frameBlock',
  group: 'block',
  nodeSpec: {
    content: 'block+',
    group: 'block',
    defining: true,
    attrs: { color: { default: '#8ab4f8' } },
    parseDOM: [{ tag: 'div.frame-block' }],
    toDOM() { return ['div', { class: 'frame-block' }, 0]; },
  },
  nodeView: frameBlockNodeView,
  capabilities: { turnInto: ['textBlock'], canDelete: true, canDrag: true },
  containerRule: {},
  slashMenu: { label: 'Frame', icon: '▢', group: 'layout', keywords: ['frame', 'border', 'box', '彩框'], order: 1 },
};
