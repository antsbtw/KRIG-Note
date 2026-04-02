import type { BlockDef } from '../types';

/**
 * taskList — 待办清单
 *
 * Container：包含 taskItem+ 子节点。
 * 类似 bulletList 但子项带 checkbox。
 */

export const taskListBlock: BlockDef = {
  name: 'taskList',
  group: 'block',

  nodeSpec: {
    content: 'taskItem+',
    group: 'block',
    parseDOM: [{ tag: 'ul.task-list' }],
    toDOM() { return ['ul', { class: 'task-list' }, 0]; },
  },

  capabilities: {
    turnInto: ['paragraph', 'bulletList'],
    canDelete: true,
    canDrag: true,
  },

  containerRule: {},

  slashMenu: {
    label: 'Task List',
    icon: '☐',
    group: 'basic',
    keywords: ['task', 'todo', 'checkbox', 'checklist'],
    order: 7,
  },
};
