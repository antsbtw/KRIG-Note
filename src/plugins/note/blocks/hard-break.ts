import type { BlockDef } from '../types';

export const hardBreakBlock: BlockDef = {
  name: 'hardBreak',
  group: 'inline',
  nodeSpec: {
    inline: true,
    group: 'inline',
    selectable: false,
    parseDOM: [{ tag: 'br' }],
    toDOM() { return ['br']; },
  },
  capabilities: {},
  slashMenu: null,
};
