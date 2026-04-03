import type { BlockDef } from '../types';
import { createRenderBlockView, type RenderBlockRenderer } from './render-block-base';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

/**
 * mathBlock — 行间数学公式（RenderBlock）
 *
 * 默认：只显示 KaTeX 渲染的公式
 * 点击：展开编辑框（上方 LaTeX 输入 + 下方实时预览）
 * 回车/点击外部：收起，只保留公式
 */

let katexModule: typeof import('katex') | null = null;
async function ensureKatex() {
  if (!katexModule) {
    katexModule = await import('katex');
  }
  return katexModule.default || katexModule;
}

function renderKatex(el: HTMLElement, latex: string, placeholder?: string) {
  if (!latex.trim()) {
    el.innerHTML = placeholder || '<span style="color:#666;font-style:italic;">点击输入公式</span>';
    return;
  }
  ensureKatex().then((katex) => {
    try {
      katex.render(latex, el, { displayMode: true, throwOnError: false });
    } catch {
      el.textContent = latex;
    }
  });
}

/** MathBlock Renderer */
const mathRenderer: RenderBlockRenderer = {
  label(node) {
    return 'Math';
  },

  createContent(node: PMNode, view: EditorView, getPos: () => number | undefined): HTMLElement {
    const content = document.createElement('div');
    content.classList.add('math-block');

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
    let currentNode = node;

    function autoHeight() {
      textarea.style.height = 'auto';
      textarea.style.height = Math.max(36, textarea.scrollHeight) + 'px';
    }

    function enterEdit() {
      if (isEditing) return;
      isEditing = true;
      textarea.value = currentNode.attrs.latex || '';
      renderKatex(livePreview, currentNode.attrs.latex || '');
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
      if (latex !== currentNode.attrs.latex) {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (pos != null) {
          view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...currentNode.attrs, latex }));
        }
      }
      renderKatex(preview, latex);
    }

    textarea.addEventListener('input', () => {
      autoHeight();
      renderKatex(livePreview, textarea.value);
    });

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

    preview.addEventListener('click', (e) => {
      e.stopPropagation();
      enterEdit();
    });

    function handleClickOutside(e: MouseEvent) {
      if (isEditing && !content.contains(e.target as Node)) {
        exitEdit();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);

    // 初始渲染
    renderKatex(preview, node.attrs.latex || '');

    content.appendChild(editor);
    content.appendChild(preview);

    // 存储清理函数
    (content as any)._cleanup = () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
    // 存储引用供 update 使用
    (content as any)._refs = { textarea, preview, livePreview, editor, isEditing: () => isEditing, setNode: (n: PMNode) => { currentNode = n; } };

    return content;
  },

  update(node: PMNode, contentEl: HTMLElement): boolean {
    const refs = (contentEl as any)._refs;
    if (!refs) return true;
    refs.setNode(node);

    if (!refs.isEditing()) {
      renderKatex(refs.preview, node.attrs.latex || '');
    } else if (node.attrs.latex !== refs.textarea.value) {
      refs.textarea.value = node.attrs.latex || '';
      renderKatex(refs.livePreview, node.attrs.latex || '');
    }
    return true;
  },

  createFullscreenContent(node: PMNode): HTMLElement | null {
    if (!node.attrs.latex?.trim()) return null;
    const el = document.createElement('div');
    el.style.padding = '40px';
    el.style.background = '#1e1e1e';
    el.style.borderRadius = '12px';
    renderKatex(el, node.attrs.latex);
    return el;
  },

  destroy(contentEl: HTMLElement) {
    (contentEl as any)._cleanup?.();
  },
};

export const mathBlockBlock: BlockDef = {
  name: 'mathBlock',
  group: 'block',

  nodeSpec: {
    group: 'block',
    atom: true,
    attrs: { latex: { default: '' } },
    parseDOM: [{ tag: 'div.math-block' }],
    toDOM() { return ['div', { class: 'math-block' }, 0]; },
  },

  nodeView: createRenderBlockView(mathRenderer, 'math'),

  capabilities: {
    turnInto: ['textBlock'],
    canDelete: true,
    canDrag: true,
  },

  slashMenu: {
    label: 'Math Block',
    icon: '∑',
    group: 'math',
    keywords: ['math', 'equation', 'formula', 'latex', 'katex', '公式'],
    order: 0,
  },
};
