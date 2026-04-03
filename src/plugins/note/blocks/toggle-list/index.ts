import type { BlockDef } from '../../types';
import { toggleListNodeView } from './view';

/**
 * toggleList — 折叠列表
 *
 * Container：block+ 子节点，无必填首子。
 * 首行作为摘要始终可见，第二个 block 开始为折叠区域。
 */

export const toggleListBlock: BlockDef = {
  name: 'toggleList',
  group: 'block',

  nodeSpec: {
    content: 'block+',
    group: 'block',
    attrs: { open: { default: true } },
    parseDOM: [{ tag: 'div.toggle-list' }],
    toDOM() { return ['div', { class: 'toggle-list' }, 0]; },
  },

  nodeView: toggleListNodeView,

  enterBehavior: {
    action: 'split',
    exitCondition: 'empty-enter',
  },

  capabilities: {
    turnInto: ['textBlock'],
    canDelete: true,
    canDrag: true,
  },

  containerRule: {},

  slashMenu: {
    label: 'Toggle List',
    icon: '▸',
    group: 'toggle',
    keywords: ['toggle', 'collapse', 'fold', 'detail', 'summary'],
    order: 1,
  },
};
