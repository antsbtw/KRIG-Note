import type { BlockDef } from '../types';

/**
 * orderedList — 有序列表
 *
 * Container：包含 listItem+ 子节点。
 * 编号样式按嵌套层级变化：数字 → 字母 → 罗马
 * 支持自定义起始编号（start attr）。
 */

export const orderedListBlock: BlockDef = {
  name: 'orderedList',
  group: 'block',

  nodeSpec: {
    content: 'listItem+',
    group: 'block',
    attrs: { start: { default: 1 } },
    parseDOM: [{ tag: 'ol', getAttrs(dom: HTMLElement) {
      return { start: dom.hasAttribute('start') ? +dom.getAttribute('start')! : 1 };
    }}],
    toDOM(node) {
      return node.attrs.start === 1
        ? ['ol', 0]
        : ['ol', { start: node.attrs.start }, 0];
    },
  },

  capabilities: {
    turnInto: ['paragraph', 'bulletList', 'taskList'],
    canDuplicate: true,
    canDelete: true,
    canDrag: true,
  },

  containerRule: {},

  slashMenu: {
    label: 'Numbered List',
    icon: '1.',
    group: 'basic',
    keywords: ['list', 'number', 'ol', 'ordered'],
    order: 6,
  },
};
