import type { BlockDef, NodeViewFactory } from '../types';

/**
 * taskList + taskItem — 任务列表（ContainerBlock 二层结构）
 *
 * taskList（content: 'taskItem+'）→ taskItem（content: 'block+'）
 *
 * taskItem 是 ContainerBlock 中间层，自带 checkbox 和时间 attrs。
 * 遵循三基类架构：checkbox 是 Container（taskItem）自己的装饰，不侵入子 Block。
 */

function generateId(): string {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

// ── taskItem NodeView ──

const taskItemNodeView: NodeViewFactory = (node, view, getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('task-item');
  syncState(dom, node.attrs);

  // Checkbox（不可编辑）
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.classList.add('task-item__checkbox');
  checkbox.contentEditable = 'false';
  checkbox.checked = !!node.attrs.checked;
  checkbox.addEventListener('mousedown', (e) => e.preventDefault());
  checkbox.addEventListener('click', (e) => {
    e.stopPropagation();
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos == null) return;
    const currentNode = view.state.doc.nodeAt(pos);
    if (!currentNode) return;

    const nowISO = new Date().toISOString();
    const newChecked = !currentNode.attrs.checked;
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, {
      ...currentNode.attrs,
      checked: newChecked,
      completedAt: newChecked ? nowISO : null,
    }));
  });
  dom.appendChild(checkbox);

  // Content（ProseMirror 管理子 Block）
  const contentDOM = document.createElement('div');
  contentDOM.classList.add('task-item__content');
  dom.appendChild(contentDOM);

  // 时间标签（hover 时显示，点击设置 deadline）
  const timeLabel = document.createElement('span');
  timeLabel.classList.add('task-item__time');
  timeLabel.contentEditable = 'false';
  dom.appendChild(timeLabel);

  // 隐藏的 date input（点击时间标签触发）
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.classList.add('task-item__date-input');
  dom.appendChild(dateInput);

  timeLabel.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // 设置当前 deadline 值
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos == null) return;
    const n = view.state.doc.nodeAt(pos);
    if (n?.attrs.deadline) {
      dateInput.value = n.attrs.deadline.slice(0, 10); // YYYY-MM-DD
    } else {
      dateInput.value = '';
    }
    dateInput.showPicker();
  });

  dateInput.addEventListener('change', () => {
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos == null) return;
    const currentNode = view.state.doc.nodeAt(pos);
    if (!currentNode) return;
    const deadline = dateInput.value ? new Date(dateInput.value + 'T23:59:59').toISOString() : null;
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, {
      ...currentNode.attrs,
      deadline,
    }));
  });

  function syncState(el: HTMLElement, attrs: Record<string, any>) {
    el.classList.toggle('task-item--checked', !!attrs.checked);
    // 超期标记
    if (!attrs.checked && attrs.deadline) {
      el.classList.toggle('task-item--overdue', new Date(attrs.deadline) < new Date());
    } else {
      el.classList.remove('task-item--overdue');
    }
  }

  function formatDate(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function updateTimeLabel(attrs: Record<string, any>) {
    const parts: string[] = [];
    if (attrs.checked && attrs.completedAt) {
      parts.push(`${formatDate(attrs.completedAt)} 完成`);
    } else {
      if (attrs.createdAt) parts.push(`${formatDate(attrs.createdAt)} 创建`);
      if (attrs.deadline) parts.push(`截止 ${formatDate(attrs.deadline)}`);
    }
    timeLabel.textContent = parts.join(' · ');
  }

  updateTimeLabel(node.attrs);

  return {
    dom,
    contentDOM,
    update(updatedNode) {
      if (updatedNode.type.name !== 'taskItem') return false;
      checkbox.checked = !!updatedNode.attrs.checked;
      syncState(dom, updatedNode.attrs);
      updateTimeLabel(updatedNode.attrs);
      return true;
    },
  };
};

// ── taskList NodeView ──

const taskListNodeView: NodeViewFactory = (node, view, getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('task-list');

  return {
    dom,
    contentDOM: dom,
    update(updatedNode) { return updatedNode.type.name === 'taskList'; },
  };
};

// ── BlockDef ──

export const taskItemBlock: BlockDef = {
  name: 'taskItem',
  group: '',  // 不在 block group 中，只作为 taskList 的子节点
  nodeSpec: {
    content: 'block+',
    defining: true,
    attrs: {
      atomId: { default: null },
      checked: { default: false },
      createdAt: { default: null },
      completedAt: { default: null },
      deadline: { default: null },
    },
    parseDOM: [{
      tag: 'div.task-item',
      getAttrs(dom) {
        return {
          checked: (dom as HTMLElement).classList.contains('task-item--checked'),
        };
      },
    }],
    toDOM(node) {
      return ['div', {
        class: `task-item ${node.attrs.checked ? 'task-item--checked' : ''}`,
      }, 0];
    },
  },
  nodeView: taskItemNodeView,
  capabilities: { canDelete: true },
  containerRule: {},
};

export const taskListBlock: BlockDef = {
  name: 'taskList',
  group: 'block',
  nodeSpec: {
    content: 'taskItem+',
    group: 'block',
    parseDOM: [{ tag: 'div.task-list' }],
    toDOM() { return ['div', { class: 'task-list' }, 0]; },
  },
  nodeView: taskListNodeView,
  capabilities: { turnInto: ['textBlock'], canDelete: true, canDrag: true },
  containerRule: {},
  slashMenu: { label: 'Task List', icon: '☐', group: 'basic', keywords: ['task', 'todo', 'checkbox', '待办'], order: 7 },
};
