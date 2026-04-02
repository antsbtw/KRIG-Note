import type { BlockDef, NodeViewFactory } from '../types';
import katex from 'katex';

/**
 * mathInline — 行内数学公式（atom 节点）
 *
 * 预览模式：KaTeX 渲染的行内公式
 * 点击 → 弹出编辑框输入 LaTeX
 */

const mathInlineNodeView: NodeViewFactory = (node, view, getPos) => {
  const dom = document.createElement('span');
  dom.classList.add('math-inline');
  dom.contentEditable = 'false';

  function render(latex: string) {
    if (!latex.trim()) {
      dom.innerHTML = '<span class="math-inline__placeholder">$</span>';
      return;
    }
    try {
      katex.render(latex, dom, { displayMode: false, throwOnError: false });
    } catch {
      dom.textContent = `$${latex}$`;
    }
  }

  render(node.attrs.latex || '');

  // 点击 → 弹出编辑
  dom.addEventListener('click', (e) => {
    e.stopPropagation();

    const existing = document.querySelector('.math-inline-editor');
    if (existing) existing.remove();

    const popup = document.createElement('div');
    popup.classList.add('math-inline-editor');
    const rect = dom.getBoundingClientRect();
    popup.style.left = `${rect.left}px`;
    popup.style.top = `${rect.bottom + 4}px`;

    const input = document.createElement('input');
    input.type = 'text';
    input.classList.add('math-inline-editor__input');
    input.value = node.attrs.latex || '';
    input.placeholder = 'LaTeX...';

    const previewEl = document.createElement('div');
    previewEl.classList.add('math-inline-editor__preview');

    function updatePreview() {
      try {
        katex.render(input.value, previewEl, { displayMode: false, throwOnError: false });
      } catch {
        previewEl.textContent = input.value;
      }
    }
    updatePreview();

    input.addEventListener('input', updatePreview);

    function commit() {
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos != null && input.value !== node.attrs.latex) {
        const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, latex: input.value });
        view.dispatch(tr);
      }
      popup.remove();
      view.focus();
    }

    input.addEventListener('keydown', (ke) => {
      if (ke.key === 'Enter') { ke.preventDefault(); commit(); }
      if (ke.key === 'Escape') { ke.preventDefault(); popup.remove(); view.focus(); }
    });

    // 点击外部关闭
    const closeHandler = (ce: MouseEvent) => {
      if (!popup.contains(ce.target as Node)) {
        commit();
        document.removeEventListener('mousedown', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', closeHandler), 50);

    popup.appendChild(input);
    popup.appendChild(previewEl);
    document.body.appendChild(popup);
    input.focus();
    input.select();
  });

  return {
    dom,
    update(updatedNode) {
      if (updatedNode.type.name !== 'mathInline') return false;
      render(updatedNode.attrs.latex || '');
      node = updatedNode;
      return true;
    },
    ignoreMutation() { return true; },
    selectNode() { dom.classList.add('math-inline--selected'); },
    deselectNode() { dom.classList.remove('math-inline--selected'); },
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
    parseDOM: [{
      tag: 'span.math-inline',
      getAttrs(dom: HTMLElement) {
        return { latex: dom.getAttribute('data-latex') || '' };
      },
    }],
    toDOM(node) {
      return ['span', { class: 'math-inline', 'data-latex': node.attrs.latex }, `$${node.attrs.latex}$`];
    },
  },

  nodeView: mathInlineNodeView,

  capabilities: {},

  slashMenu: {
    label: 'Inline Math',
    icon: '$x$',
    group: 'math',
    keywords: ['math', 'inline', 'formula', 'latex', '公式'],
    order: 1,
  },
};
