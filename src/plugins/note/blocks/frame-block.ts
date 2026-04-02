import type { BlockDef, NodeViewFactory } from '../types';

/**
 * frameBlock — 彩框容器
 *
 * 纯视觉分组容器，左侧彩色边框。
 * 类似 callout 但无 emoji，只有边框颜色。
 */

const FRAME_COLORS: Record<string, string> = {
  blue: '#8ab4f8',
  red: '#f28b82',
  green: '#81c995',
  yellow: '#fdd663',
  purple: '#c58af9',
};

const COLOR_KEYS = Object.keys(FRAME_COLORS);

const frameBlockNodeView: NodeViewFactory = (node, view, getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('frame-block');
  dom.style.borderLeftColor = FRAME_COLORS[node.attrs.color] || FRAME_COLORS.blue;

  // 点击边框区域循环切换颜色
  const colorStrip = document.createElement('div');
  colorStrip.classList.add('frame-block__strip');
  colorStrip.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos == null) return;
    const currentIndex = COLOR_KEYS.indexOf(node.attrs.color);
    const nextIndex = (currentIndex + 1) % COLOR_KEYS.length;
    const tr = view.state.tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      color: COLOR_KEYS[nextIndex],
    });
    view.dispatch(tr);
  });

  const contentDOM = document.createElement('div');
  contentDOM.classList.add('frame-block__content');

  dom.appendChild(colorStrip);
  dom.appendChild(contentDOM);

  return {
    dom,
    contentDOM,
    update(updatedNode) {
      if (updatedNode.type.name !== 'frameBlock') return false;
      dom.style.borderLeftColor = FRAME_COLORS[updatedNode.attrs.color] || FRAME_COLORS.blue;
      node = updatedNode;
      return true;
    },
    ignoreMutation(mutation) {
      return mutation.target === colorStrip;
    },
  };
};

export const frameBlockBlock: BlockDef = {
  name: 'frameBlock',
  group: 'block',

  nodeSpec: {
    content: 'block+',
    group: 'block',
    attrs: { color: { default: 'blue' } },
    parseDOM: [{ tag: 'div.frame-block' }],
    toDOM() { return ['div', { class: 'frame-block' }, 0]; },
  },

  nodeView: frameBlockNodeView,

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
    label: 'Frame',
    icon: '▢',
    group: 'layout',
    keywords: ['frame', 'border', 'box', '边框', '彩框'],
    order: 2,
  },
};
