import type { NodeViewFactory } from '../../types';

/**
 * toggleList NodeView
 *
 * 与 toggleHeading 类似，但首行是 paragraph 而非 heading。
 * 首行始终可见，第二个 block 开始为折叠区域。
 */

export const toggleListNodeView: NodeViewFactory = (node, view, getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('toggle-list');

  const isOpen = node.attrs.open !== false;
  if (!isOpen) dom.classList.add('toggle-list--closed');

  // Toggle 按钮
  const toggleBtn = document.createElement('span');
  toggleBtn.classList.add('toggle-list__toggle');
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

  // contentDOM
  const contentDOM = document.createElement('div');
  contentDOM.classList.add('toggle-list__content');
  dom.appendChild(contentDOM);

  return {
    dom,
    contentDOM,
    update(updatedNode) {
      if (updatedNode.type.name !== 'toggleList') return false;
      const open = updatedNode.attrs.open !== false;
      dom.classList.toggle('toggle-list--closed', !open);
      toggleBtn.textContent = open ? '▾' : '▸';
      return true;
    },
    ignoreMutation(mutation) {
      return mutation.target === toggleBtn || toggleBtn.contains(mutation.target as Node);
    },
  };
};
