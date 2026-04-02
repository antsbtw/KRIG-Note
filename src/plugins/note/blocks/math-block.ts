import type { BlockDef, NodeViewFactory } from '../types';
import katex from 'katex';

/**
 * mathBlock — 行间数学公式
 *
 * 默认：只显示 KaTeX 渲染的公式
 * 点击：展开编辑框（上方 LaTeX 输入 + 下方实时预览）
 * 回车/点击外部：收起，只保留公式
 */

const mathBlockNodeView: NodeViewFactory = (node, view, getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('math-block');

  // 编辑区域（默认隐藏）
  const editor = document.createElement('div');
  editor.classList.add('math-block__editor');
  editor.style.display = 'none';

  const textarea = document.createElement('textarea');
  textarea.classList.add('math-block__input');
  textarea.placeholder = '输入 LaTeX 公式...';
  textarea.spellcheck = false;

  const livePreview = document.createElement('div');
  livePreview.classList.add('math-block__live-preview');

  editor.appendChild(textarea);
  editor.appendChild(livePreview);

  // 预览区域（默认显示）
  const preview = document.createElement('div');
  preview.classList.add('math-block__preview');

  let isEditing = false;

  function renderTo(el: HTMLElement, latex: string, placeholder?: string) {
    if (!latex.trim()) {
      el.innerHTML = placeholder || '<span class="math-block__placeholder">点击输入公式</span>';
      return;
    }
    try {
      katex.render(latex, el, { displayMode: true, throwOnError: false });
    } catch {
      el.textContent = latex;
    }
  }

  function autoHeight() {
    textarea.style.height = 'auto';
    textarea.style.height = Math.max(36, textarea.scrollHeight) + 'px';
  }

  function enterEdit() {
    if (isEditing) return;
    isEditing = true;
    textarea.value = node.attrs.latex || '';
    renderTo(livePreview, node.attrs.latex || '', '');
    editor.style.display = 'block';
    preview.style.display = 'none';
    textarea.focus();
    setTimeout(autoHeight, 0);
  }

  function exitEdit() {
    if (!isEditing) return;
    isEditing = false;
    editor.style.display = 'none';
    preview.style.display = 'block';

    const latex = textarea.value;
    if (latex !== node.attrs.latex) {
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos != null) {
        view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, latex }));
      }
    }
    renderTo(preview, latex);
  }

  // 实时预览
  textarea.addEventListener('input', () => {
    autoHeight();
    renderTo(livePreview, textarea.value, '');
  });

  // Enter → 退出编辑（Shift+Enter → 换行）
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      exitEdit();
      view.focus();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      exitEdit();
      view.focus();
    }
  });

  // 点击预览 → 编辑
  preview.addEventListener('click', (e) => {
    e.stopPropagation();
    enterEdit();
  });

  // 点击外部 → 退出编辑
  function handleClickOutside(e: MouseEvent) {
    if (isEditing && !dom.contains(e.target as Node)) {
      exitEdit();
    }
  }
  document.addEventListener('mousedown', handleClickOutside);

  // 初始渲染
  renderTo(preview, node.attrs.latex || '');

  dom.appendChild(editor);
  dom.appendChild(preview);

  return {
    dom,
    stopEvent(event) {
      if (dom.contains(event.target as Node)) return true;
      return false;
    },
    update(updatedNode) {
      if (updatedNode.type.name !== 'mathBlock') return false;
      node = updatedNode;
      if (!isEditing) {
        renderTo(preview, updatedNode.attrs.latex || '');
      } else if (updatedNode.attrs.latex !== textarea.value) {
        textarea.value = updatedNode.attrs.latex || '';
        autoHeight();
        renderTo(livePreview, updatedNode.attrs.latex || '', '');
      }
      return true;
    },
    ignoreMutation() { return true; },
    destroy() {
      document.removeEventListener('mousedown', handleClickOutside);
    },
  };
};

export const mathBlockBlock: BlockDef = {
  name: 'mathBlock',
  group: 'block',

  nodeSpec: {
    group: 'block',
    content: 'text*',
    code: true,
    marks: '',
    attrs: { latex: { default: '' } },
    parseDOM: [{ tag: 'div.math-block' }],
    toDOM() { return ['div', { class: 'math-block' }, 0]; },
  },

  nodeView: mathBlockNodeView,

  capabilities: {
    turnInto: ['paragraph'],
    canDelete: true,
    canDrag: true,
  },

  enterBehavior: {
    action: 'newline',
    exitCondition: 'double-enter',
  },

  slashMenu: {
    label: 'Math Block',
    icon: '∑',
    group: 'math',
    keywords: ['math', 'equation', 'formula', 'latex', 'katex', '公式'],
    order: 0,
  },
};
