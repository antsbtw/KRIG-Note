import type { BlockDef, NodeViewFactory } from '../types';

/**
 * taskList — 任务列表（ContainerBlock）
 *
 * content: 'block+'，checkbox 通过 CSS ::before 渲染。
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
    update(updatedNode) { return updatedNode.type.name === 'taskList'; },
  };
};

export const taskListBlock: BlockDef = {
  name: 'taskList',
  group: 'block',
  nodeSpec: {
    content: 'block+',
    group: 'block',
    defining: true,
    parseDOM: [{ tag: 'div.task-list' }],
    toDOM() { return ['div', { class: 'task-list' }, 0]; },
  },
  nodeView: taskListNodeView,
  capabilities: { turnInto: ['textBlock'], canDelete: true, canDrag: true },
  containerRule: {},
  slashMenu: { label: 'Task List', icon: '☐', group: 'basic', keywords: ['task', 'todo', 'checkbox', '待办'], order: 7 },
};
