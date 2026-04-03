import type { BlockDef } from '../types';

/**
 * listItem — 列表项
 *
 * bulletList 和 orderedList 共享的子节点。
 * Container：必填首子 paragraph + 任意 block。
 * 不属于 block 组（不能独立存在于文档中）。
 */

export const listItemBlock: BlockDef = {
  name: 'listItem',
  group: '',  // 不属于 block 组，只能在列表中

  nodeSpec: {
    content: 'textBlock block*',
    defining: true,
    parseDOM: [{ tag: 'li' }],
    toDOM() { return ['li', 0]; },
  },

  capabilities: {
    canDuplicate: true,
    canDelete: true,
    canDrag: true,
  },

  enterBehavior: {
    action: 'split',
    exitCondition: 'empty-enter',
  },

  containerRule: {
    requiredFirstChildType: 'textBlock',
  },

  slashMenu: null,
};
