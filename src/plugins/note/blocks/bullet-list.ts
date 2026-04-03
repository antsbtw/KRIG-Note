import type { BlockDef } from '../types';

/**
 * bulletList — 无序列表
 *
 * Container：包含 listItem+ 子节点。
 * 标记样式按嵌套层级循环：• → ◦ → ▪
 */

export const bulletListBlock: BlockDef = {
  name: 'bulletList',
  group: 'block',

  nodeSpec: {
    content: 'listItem+',
    group: 'block',
    parseDOM: [{ tag: 'ul' }],
    toDOM() { return ['ul', 0]; },
  },

  capabilities: {
    turnInto: ['textBlock', 'orderedList', 'taskList'],
    canDuplicate: true,
    canDelete: true,
    canDrag: true,
  },

  containerRule: {},

  slashMenu: {
    label: 'Bullet List',
    icon: '•',
    group: 'basic',
    keywords: ['list', 'bullet', 'ul', 'unordered'],
    order: 5,
  },
};
