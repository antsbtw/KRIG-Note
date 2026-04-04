import type { BlockDef } from '../types';

export const horizontalRuleBlock: BlockDef = {
  name: 'horizontalRule',
  group: 'block',
  nodeSpec: {
    group: 'block',
    atom: true,
    parseDOM: [{ tag: 'hr' }],
    toDOM() { return ['hr']; },
  },
  capabilities: { canDelete: true, canDrag: true },
  slashMenu: { label: 'Divider', icon: '—', group: 'basic', keywords: ['divider', 'hr', 'rule', '分割线'], order: 12 },
};
