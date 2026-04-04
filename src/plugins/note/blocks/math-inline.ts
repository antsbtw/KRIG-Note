import type { BlockDef, NodeViewFactory } from '../types';

/**
 * mathInline — 行内公式（Inline atom）
 */

const mathInlineNodeView: NodeViewFactory = (node, view, getPos) => {
  const dom = document.createElement('span');
  dom.classList.add('math-inline');

  function render() {
    const latex = node.attrs.latex || '';
    if (!latex) {
      dom.textContent = '∑';
      dom.style.color = '#555';
      return;
    }
    import('katex').then(({ default: katex }) => {
      try {
        katex.render(latex, dom, { throwOnError: false, displayMode: false });
      } catch {
        dom.textContent = latex;
      }
    });
  }

  render();

  // 点击编辑
  dom.addEventListener('click', () => {
    const newLatex = prompt('LaTeX:', node.attrs.latex || '');
    if (newLatex === null) return;
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos == null) return;
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { latex: newLatex }));
  });

  return {
    dom,
    update(updatedNode) {
      if (updatedNode.type.name !== 'mathInline') return false;
      node = updatedNode;
      render();
      return true;
    },
    stopEvent() { return true; },
    ignoreMutation() { return true; },
  };
};

export const mathInlineBlock: BlockDef = {
  name: 'mathInline',
  group: 'inline',
  nodeSpec: {
    inline: true,
    group: 'inline',
    atom: true,
    attrs: { latex: { default: '' } },
    parseDOM: [{ tag: 'span.math-inline' }],
    toDOM() { return ['span', { class: 'math-inline' }]; },
  },
  nodeView: mathInlineNodeView,
  capabilities: {},
  slashMenu: { label: 'Inline Math', icon: '∑', group: 'basic', keywords: ['math', 'inline', 'formula', '公式'], order: 14 },
};
