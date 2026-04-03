import type { BlockDef } from '../../types';
import { toggleHeadingNodeView } from './view';
import { toggleHeadingPlugin } from './plugin';

/**
 * toggleHeading — 折叠标题
 *
 * Container：必填首子 heading + block*
 * heading 的升级形态——标题 + 可折叠子内容。
 */

export const toggleHeadingBlock: BlockDef = {
  name: 'toggleHeading',
  group: 'block',

  nodeSpec: {
    content: 'textBlock block*',
    group: 'block',
    attrs: { open: { default: true } },
    parseDOM: [{ tag: 'div.toggle-heading' }],
    toDOM() { return ['div', { class: 'toggle-heading' }, 0]; },
  },

  nodeView: toggleHeadingNodeView,
  plugin: () => toggleHeadingPlugin(),

  enterBehavior: {
    action: 'split',
    exitCondition: 'empty-enter',
  },

  capabilities: {
    turnInto: ['paragraph', 'heading', 'toggleList'],
    canDelete: true,
    canDrag: true,
  },

  containerRule: {
    requiredFirstChildType: 'heading',
    convertTo: 'toggleList',
  },

  slashMenu: {
    label: 'Toggle Heading',
    icon: '▸',
    group: 'toggle',
    keywords: ['toggle', 'collapse', 'fold', 'accordion'],
    order: 0,
  },
};
