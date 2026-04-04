import type { BlockDef, NodeViewFactory } from '../types';

/**
 * taskList — 任务列表（ContainerBlock）
 *
 * Container：block+ 子节点。
 * 为每个直接子 textBlock 渲染 checkbox（☐/☑）。
 * checked 状态通过子 textBlock 的 data-checked attr 管理。
 */

const taskListNodeView: NodeViewFactory = (node, view, getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('task-list');

  const contentDOM = document.createElement('div');
  contentDOM.classList.add('task-list__content');
  dom.appendChild(contentDOM);

  return {
    dom,
    contentDOM,
    update(updatedNode) {
      return updatedNode.type.name === 'taskList';
    },
    ignoreMutation() { return false; },
  };
};

export const taskListBlock: BlockDef = {
  name: 'taskList',
  group: 'block',

  nodeSpec: {
    content: 'block+',
    group: 'block',
    defining: true,
    parseDOM: [{ tag: 'ul.task-list' }, { tag: 'div.task-list' }],
    toDOM() { return ['div', { class: 'task-list' }, 0]; },
  },

  nodeView: taskListNodeView,

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
    label: 'Task List',
    icon: '☐',
    group: 'basic',
    keywords: ['task', 'todo', 'checkbox', 'checklist', '待办'],
    order: 7,
  },
};
