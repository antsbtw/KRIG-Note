import type { BlockDef } from '../types';

/**
 * hardBreak — 软换行（Shift+Enter）
 *
 * inline 节点，渲染为 <br>。
 * 不可选中，不出现在 SlashMenu。
 */

export const hardBreakBlock: BlockDef = {
  name: 'hardBreak',
  group: 'inline',

  nodeSpec: {
    inline: true,
    group: 'inline',
    selectable: false,
    parseDOM: [{ tag: 'br' }],
    toDOM() { return ['br'] as const; },
  },

  capabilities: {},

  slashMenu: null,
};
