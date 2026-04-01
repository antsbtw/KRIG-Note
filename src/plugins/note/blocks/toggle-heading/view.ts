import type { NodeViewFactory } from '../../types';

/**
 * toggleHeading NodeView
 *
 * 结构：
 * ┌─ toggleHeading ─────────────────────┐
 * │ [▸/▾] heading 内容（始终可见）       │
 * │ ┌─ 折叠区域 ────────────────────┐   │
 * │ │ block* 子内容（折叠时隐藏）    │   │
 * │ └───────────────────────────────┘   │
 * └─────────────────────────────────────┘
 */

export const toggleHeadingNodeView: NodeViewFactory = (node, view, getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('toggle-heading');

  const isOpen = node.attrs.open !== false;
  if (!isOpen) dom.classList.add('toggle-heading--closed');

  // Toggle 按钮
  const toggleBtn = document.createElement('span');
  toggleBtn.classList.add('toggle-heading__toggle');
  toggleBtn.textContent = isOpen ? '▾' : '▸';
  toggleBtn.contentEditable = 'false';
  toggleBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = getPos();
    if (pos === undefined) return;
    const currentOpen = view.state.doc.nodeAt(pos)?.attrs.open !== false;
    view.dispatch(
      view.state.tr.setNodeMarkup(pos, undefined, { open: !currentOpen }),
    );
  });

  dom.appendChild(toggleBtn);

  // contentDOM — ProseMirror 管理子节点（heading + block*）
  const contentDOM = document.createElement('div');
  contentDOM.classList.add('toggle-heading__content');
  dom.appendChild(contentDOM);

  return {
    dom,
    contentDOM,
    update(updatedNode) {
      if (updatedNode.type.name !== 'toggleHeading') return false;
      const open = updatedNode.attrs.open !== false;
      dom.classList.toggle('toggle-heading--closed', !open);
      toggleBtn.textContent = open ? '▾' : '▸';
      return true;
    },
    ignoreMutation(mutation) {
      // 忽略 toggle 按钮的 mutation
      return mutation.target === toggleBtn || toggleBtn.contains(mutation.target as Node);
    },
  };
};
