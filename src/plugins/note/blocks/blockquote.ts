import type { BlockDef } from '../types';

export const blockquoteBlock: BlockDef = {
  name: 'blockquote',
  group: 'block',

  nodeSpec: {
    content: 'block+',
    group: 'block',
    defining: true,
    parseDOM: [{ tag: 'blockquote' }],
    toDOM() { return ['blockquote', 0]; },
  },

  capabilities: {
    turnInto: ['textBlock'],
    marks: [],
    canDuplicate: true,
    canDelete: true,
    canDrag: true,
  },

  enterBehavior: {
    action: 'split',
    exitCondition: 'empty-enter',
  },

  containerRule: {
    requiredFirstChildType: undefined,
  },

  slashMenu: {
    label: 'Quote',
    icon: '"',
    group: 'basic',
    keywords: ['quote', 'blockquote', 'cite'],
    order: 10,
  },
};
