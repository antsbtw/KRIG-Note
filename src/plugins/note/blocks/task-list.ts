import type { BlockDef, NodeViewFactory } from '../types';

/**
 * taskList — 任务列表（ContainerBlock）
 *
 * content: 'block+'，checkbox 通过 CSS ::before 渲染。
 * checked 状态存储在 attrs.checkedItems（子 block 索引 → boolean）。
 * NodeView 监听点击事件，检测 checkbox 区域并切换 checked 状态。
 */

const taskListNodeView: NodeViewFactory = (initialNode, view, getPos) => {
  let node = initialNode;
  const dom = document.createElement('div');
  dom.classList.add('task-list');

  const contentDOM = document.createElement('div');
  contentDOM.classList.add('task-list__content');
  dom.appendChild(contentDOM);

  function syncCheckedClasses(checkedItems: Record<string, boolean>) {
    const children = contentDOM.children;
    console.log('[taskList] syncCheckedClasses:', checkedItems, 'children:', children.length);
    for (let i = 0; i < children.length; i++) {
      const isChecked = !!checkedItems[String(i)];
      (children[i] as HTMLElement).classList.toggle('task-item--checked', isChecked);
      console.log(`[taskList] child[${i}] checked=${isChecked}, classList:`, (children[i] as HTMLElement).className);
    }
  }

  // 点击 checkbox 区域（子 block 的 padding-left 24px 内）
  // 用 capture 阶段在 dom（外层）上监听，在 ProseMirror 处理之前拦截
  dom.addEventListener('mousedown', (e) => {
    const children = Array.from(contentDOM.children) as HTMLElement[];
    console.log('[taskList] mousedown captured, children:', children.length, 'clientX:', e.clientX, 'clientY:', e.clientY);

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const rect = child.getBoundingClientRect();
      console.log(`[taskList] child[${i}] rect:`, { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, 'checkboxZone: <', rect.left + 24);
      // 点击在子 block 的 checkbox 区域内（左侧 24px）
      if (e.clientY >= rect.top && e.clientY <= rect.bottom
          && e.clientX >= rect.left && e.clientX < rect.left + 24) {
        console.log(`[taskList] ✓ hit checkbox at index ${i}`);
        e.preventDefault();
        e.stopPropagation();

        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (pos == null) return;
        const currentNode = view.state.doc.nodeAt(pos);
        if (!currentNode) return;

        const checked = { ...(currentNode.attrs.checkedItems || {}) } as Record<string, boolean>;
        checked[String(i)] = !checked[String(i)];
        view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, {
          ...currentNode.attrs,
          checkedItems: checked,
        }));
        return;
      }
    }
  }, true);  // capture phase

  // 初始同步
  setTimeout(() => syncCheckedClasses((node.attrs.checkedItems || {}) as Record<string, boolean>), 0);

  return {
    dom,
    contentDOM,
    update(updatedNode) {
      if (updatedNode.type.name !== 'taskList') return false;
      node = updatedNode;
      syncCheckedClasses((updatedNode.attrs.checkedItems || {}) as Record<string, boolean>);
      return true;
    },
  };
};

export const taskListBlock: BlockDef = {
  name: 'taskList',
  group: 'block',
  nodeSpec: {
    content: 'block+',
    group: 'block',
    defining: true,
    attrs: {
      checkedItems: { default: {} },
    },
    parseDOM: [{ tag: 'div.task-list' }],
    toDOM() { return ['div', { class: 'task-list' }, 0]; },
  },
  nodeView: taskListNodeView,
  capabilities: { turnInto: ['textBlock'], canDelete: true, canDrag: true },
  containerRule: {},
  slashMenu: { label: 'Task List', icon: '☐', group: 'basic', keywords: ['task', 'todo', 'checkbox', '待办'], order: 7 },
};
