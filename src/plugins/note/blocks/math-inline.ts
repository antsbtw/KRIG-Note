import type { BlockDef, NodeViewFactory } from '../types';
import katex from 'katex';
import 'katex/dist/katex.min.css';

/**
 * mathInline — 行内公式（Inline atom）
 *
 * - KaTeX 渲染行内公式
 * - 双击打开编辑弹窗（input + live preview）
 * - 空公式单击也可打开
 * - Enter 保存，Escape 取消，点击外部保存
 */

const mathInlineNodeView: NodeViewFactory = (node, view, getPos) => {
  const dom = document.createElement('span');
  dom.classList.add('math-inline');

  function render() {
    const latex = (node.attrs.latex as string).trim();
    if (!latex) {
      dom.innerHTML = '';
      dom.classList.add('math-inline--empty');
      dom.textContent = 'New equation';
    } else {
      dom.classList.remove('math-inline--empty');
      try {
        dom.innerHTML = katex.renderToString(latex, {
          throwOnError: false,
          displayMode: false,
          output: 'htmlAndMathml',
        });
      } catch {
        dom.textContent = latex;
      }
    }
  }

  render();

  // 双击编辑
  dom.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openEditor(node.attrs.latex);
  });

  // 空公式单击也可编辑
  dom.addEventListener('click', (e) => {
    if (!(node.attrs.latex as string).trim()) {
      e.preventDefault();
      e.stopPropagation();
      openEditor(node.attrs.latex);
    }
  });

  function openEditor(currentLatex: string) {
    // 移除已有编辑器
    document.querySelector('.math-inline-editor')?.remove();

    const editor = document.createElement('div');
    editor.classList.add('math-inline-editor');

    const input = document.createElement('input');
    input.type = 'text';
    input.classList.add('math-inline-editor__input');
    input.value = currentLatex;
    input.placeholder = 'LaTeX: e.g. x^2 + y^2 = z^2';
    editor.appendChild(input);

    const previewEl = document.createElement('div');
    previewEl.classList.add('math-inline-editor__preview');
    editor.appendChild(previewEl);

    // 定位在行内元素下方
    const rect = dom.getBoundingClientRect();
    editor.style.top = `${rect.bottom + 4}px`;
    editor.style.left = `${Math.max(8, rect.left - 40)}px`;
    document.body.appendChild(editor);

    // 实时预览
    function updatePreview(latex: string) {
      const t = latex.trim();
      if (!t) {
        previewEl.innerHTML = '<span class="math-inline-editor__hint">Preview will appear here</span>';
        return;
      }
      try {
        katex.render(t, previewEl, {
          throwOnError: false,
          displayMode: true,
          output: 'htmlAndMathml',
        });
      } catch {
        previewEl.innerHTML = '<span class="math-inline-editor__hint">Invalid LaTeX</span>';
      }
    }

    updatePreview(currentLatex);

    input.addEventListener('input', () => {
      updatePreview(input.value);
    });

    // 保存
    function save() {
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos != null) {
        view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { latex: input.value }));
      }
      editor.remove();
      view.focus();
    }

    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        save();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        editor.remove();
        view.focus();
      }
    });

    // 点击外部保存
    const closeOnClick = (ev: MouseEvent) => {
      const target = ev.target as Node;
      if (editor.contains(target) || target === dom) return;
      save();
      document.removeEventListener('mousedown', closeOnClick);
    };
    setTimeout(() => {
      document.addEventListener('mousedown', closeOnClick);
    }, 10);

    input.focus();
    input.select();
  }

  return {
    dom,
    update(updatedNode) {
      if (updatedNode.type.name !== 'mathInline') return false;
      node = updatedNode;
      render();
      return true;
    },
    stopEvent() { return false; },
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
