import type { BlockDef, NodeViewFactory } from '../types';

/**
 * bulletList — 无序列表（ContainerBlock）
 *
 * Container：block+ 子节点。
 * 为每个直接子 textBlock 渲染 bullet 标记（• ◦ ▪ 按嵌套层级循环）。
 * 支持嵌套：bulletList 内可放任意 block（包括其他 ContainerBlock）。
 */

const BULLETS = ['•', '◦', '▪'];

/** 计算当前 bulletList 的嵌套深度（祖先中有多少个 bulletList） */
function getBulletDepth(dom: HTMLElement): number {
  let depth = 0;
  let parent = dom.parentElement;
  while (parent) {
    if (parent.classList.contains('bullet-list')) depth++;
    parent = parent.parentElement;
  }
  return depth;
}

const bulletListNodeView: NodeViewFactory = (node, view, getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('bullet-list');

  const contentDOM = document.createElement('div');
  contentDOM.classList.add('bullet-list__content');
  dom.appendChild(contentDOM);

  return {
    dom,
    contentDOM,
    update(updatedNode) {
      return updatedNode.type.name === 'bulletList';
    },
    ignoreMutation() {
      return false;
    },
  };
};

export const bulletListBlock: BlockDef = {
  name: 'bulletList',
  group: 'block',

  nodeSpec: {
    content: 'block+',
    group: 'block',
    defining: true,
    parseDOM: [{ tag: 'ul' }, { tag: 'div.bullet-list' }],
    toDOM() { return ['div', { class: 'bullet-list' }, 0]; },
  },

  nodeView: bulletListNodeView,

  enterBehavior: {
    action: 'split',
    exitCondition: 'empty-enter',
  },

  capabilities: {
    turnInto: ['textBlock'],
    canDuplicate: true,
    canDelete: true,
    canDrag: true,
  },

  containerRule: {},

  slashMenu: {
    label: 'Bullet List',
    icon: '•',
    group: 'basic',
    keywords: ['list', 'bullet', 'ul', 'unordered', '无序'],
    order: 5,
  },
};
