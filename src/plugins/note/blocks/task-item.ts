import type { BlockDef, NodeViewFactory } from '../types';

/**
 * taskItem — 待办项
 *
 * Container：必填首子 paragraph + 任意 block。
 * 带 checkbox，点击切换 checked 状态。
 * checked 时文字显示为淡色 + 删除线。
 */

const taskItemNodeView: NodeViewFactory = (node, view, getPos) => {
  const dom = document.createElement('li');
  dom.classList.add('task-item');
  if (node.attrs.checked) dom.classList.add('task-item--checked');

  const checkbox = document.createElement('span');
  checkbox.classList.add('task-item__checkbox');
  checkbox.textContent = node.attrs.checked ? '☑' : '☐';
  checkbox.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos == null) return;
    const tr = view.state.tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      checked: !node.attrs.checked,
    });
    view.dispatch(tr);
  });

  const contentDOM = document.createElement('div');
  contentDOM.classList.add('task-item__content');

  dom.appendChild(checkbox);
  dom.appendChild(contentDOM);

  return {
    dom,
    contentDOM,
    update(updatedNode) {
      if (updatedNode.type.name !== 'taskItem') return false;
      const checked = updatedNode.attrs.checked;
      dom.classList.toggle('task-item--checked', checked);
      checkbox.textContent = checked ? '☑' : '☐';
      // 更新闭包引用（供 checkbox click 使用最新 attrs）
      node = updatedNode;
      return true;
    },
    ignoreMutation(mutation) {
      // 忽略 checkbox 的变更（我们自己管理）
      return mutation.target === checkbox || checkbox.contains(mutation.target as Node);
    },
  };
};

export const taskItemBlock: BlockDef = {
  name: 'taskItem',
  group: '',  // 不属于 block 组，只在 taskList 中

  nodeSpec: {
    content: 'paragraph block*',
    attrs: { checked: { default: false } },
    defining: true,
    parseDOM: [{
      tag: 'li.task-item',
      getAttrs(dom: HTMLElement) {
        return { checked: dom.classList.contains('task-item--checked') };
      },
    }],
    toDOM(node) {
      return ['li', { class: `task-item${node.attrs.checked ? ' task-item--checked' : ''}` }, 0];
    },
  },

  nodeView: taskItemNodeView,

  capabilities: {
    canDelete: true,
    canDrag: true,
  },

  enterBehavior: {
    action: 'split',
    exitCondition: 'empty-enter',
  },

  containerRule: {
    requiredFirstChildType: 'paragraph',
  },

  slashMenu: null,
};
