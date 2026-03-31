import type { BlockDef } from '../types';

export const horizontalRuleBlock: BlockDef = {
  name: 'horizontalRule',
  group: 'block',

  nodeSpec: {
    group: 'block',
    parseDOM: [{ tag: 'hr' }],
    toDOM() { return ['hr']; },
  },

  capabilities: {
    canDelete: true,
    canDrag: true,
  },

  slashMenu: {
    label: 'Divider',
    icon: '—',
    group: 'basic',
    keywords: ['hr', 'divider', 'separator', 'line'],
    order: 20,
  },
};
