import type { BlockDef } from '../types';
import { createRenderBlockView, type RenderBlockRenderer } from './render-block-base';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

/**
 * mathBlock — 数学公式（RenderBlock）
 *
 * LaTeX 输入 + KaTeX 渲染。点击切换编辑/预览模式。
 */

async function renderKatex(latex: string, container: HTMLElement): Promise<void> {
  try {
    const katex = (await import('katex')).default;
    katex.render(latex, container, { throwOnError: false, displayMode: true });
  } catch {
    container.textContent = latex || '输入 LaTeX 公式';
    container.style.color = '#888';
  }
}

const mathRenderer: RenderBlockRenderer = {
  label() { return 'Math'; },

  createContent(node: PMNode, view: EditorView, getPos: () => number | undefined): HTMLElement {
    const content = document.createElement('div');
    content.classList.add('math-block');

    const preview = document.createElement('div');
    preview.classList.add('math-block__preview');
    content.appendChild(preview);

    const editor = document.createElement('textarea');
    editor.classList.add('math-block__editor');
    editor.value = node.attrs.latex || '';
    editor.placeholder = '输入 LaTeX 公式...';
    editor.style.display = 'none';
    content.appendChild(editor);

    let isEditing = false;

    function render() {
      const latex = node.attrs.latex || '';
      if (latex) {
        renderKatex(latex, preview);
      } else {
        preview.innerHTML = '<span style="color:#555">点击输入公式</span>';
      }
    }

    render();

    // 点击预览 → 切换到编辑
    preview.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (isEditing) return;
      isEditing = true;
      editor.value = node.attrs.latex || '';
      editor.style.display = 'block';
      preview.style.display = 'none';
      setTimeout(() => editor.focus(), 0);
    });

    // 编辑器失焦 / Escape → 保存并切换回预览
    const save = () => {
      if (!isEditing) return;
      isEditing = false;
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos != null) {
        const newLatex = editor.value;
        view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, latex: newLatex }));
      }
      editor.style.display = 'none';
      preview.style.display = '';
    };

    editor.addEventListener('blur', save);
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); save(); }
    });

    (content as any)._render = render;
    return content;
  },

  update(node: PMNode, contentEl: HTMLElement): boolean {
    const render = (contentEl as any)._render;
    if (render) render();
    return true;
  },

  getCopyText(node: PMNode) { return node.attrs.latex || ''; },
};

export const mathBlockBlock: BlockDef = {
  name: 'mathBlock',
  group: 'block',
  nodeSpec: {
    group: 'block',
    atom: true,
    attrs: { latex: { default: '' } },
    parseDOM: [{ tag: 'div.math-block' }],
    toDOM() { return ['div', { class: 'math-block' }]; },
  },
  nodeView: createRenderBlockView(mathRenderer, 'math'),
  capabilities: { canDelete: true, canDrag: true },
  slashMenu: { label: 'Math Block', icon: '∑', group: 'basic', keywords: ['math', 'latex', 'equation', '公式'], order: 10 },
};
