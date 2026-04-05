import type { BlockDef, NodeViewFactory } from '../types';
import { TextSelection } from 'prosemirror-state';
import katex from 'katex';
import 'katex/dist/katex.min.css';

/**
 * mathBlock — 块级数学公式（独立 Block）
 *
 * 参照 mirro-desktop math-block-view.ts 实现。
 *
 * - 默认：渲染 KaTeX 公式（rendered view）
 * - 点击：进入编辑模式（contentDOM LaTeX 输入 + 实时预览）
 * - Escape / 点击外部：退出编辑模式
 * - 使用 contentDOM（ProseMirror 管理文本内容），支持光标编辑、撤销重做
 */

function renderKaTeX(target: HTMLElement, source: string) {
  const trimmed = source.trim();
  if (!trimmed) {
    target.innerHTML = '<div class="math-block__empty">Click to add a TeX equation</div>';
    return;
  }
  try {
    target.innerHTML = '';
    katex.render(trimmed, target, { throwOnError: false, displayMode: true });
  } catch {
    target.innerHTML = '<div class="math-block__error">Invalid LaTeX</div>';
  }
}

const mathBlockNodeView: NodeViewFactory = (initialNode, view, getPos) => {
  let node = initialNode;
  let editing = false;
  let renderTimer: ReturnType<typeof setTimeout> | null = null;

  // ── DOM structure ──
  const dom = document.createElement('div');
  dom.classList.add('math-block-wrapper');

  // Rendered view (shown by default)
  const rendered = document.createElement('div');
  rendered.classList.add('math-block__rendered');
  rendered.setAttribute('contenteditable', 'false');
  dom.appendChild(rendered);

  // Editor area (hidden by default)
  const editorArea = document.createElement('div');
  editorArea.classList.add('math-block__editor');
  editorArea.style.display = 'none';

  // Header bar with label
  const headerBar = document.createElement('div');
  headerBar.classList.add('math-block__header');
  headerBar.setAttribute('contenteditable', 'false');

  const label = document.createElement('span');
  label.classList.add('math-block__label');
  label.textContent = '∑ Block equation';
  headerBar.appendChild(label);
  editorArea.appendChild(headerBar);

  // LaTeX input area (contentDOM) — single element, no pre>code nesting
  // ProseMirror needs contentDOM to be the direct container of text nodes
  const code = document.createElement('pre');
  code.classList.add('math-block__code');
  editorArea.appendChild(code);

  // Live preview
  const livePreview = document.createElement('div');
  livePreview.classList.add('math-block__preview');
  livePreview.setAttribute('contenteditable', 'false');
  editorArea.appendChild(livePreview);

  dom.appendChild(editorArea);

  // ── Helper: get LaTeX from cached node ──
  function getLatex(): string {
    return node.textContent;
  }

  function renderRenderedView() {
    renderKaTeX(rendered, getLatex());
  }

  function renderLivePreview() {
    const latex = getLatex();
    // Defer KaTeX rendering to avoid interfering with ProseMirror's DOMObserver flush
    requestAnimationFrame(() => {
      renderKaTeX(livePreview, latex);
    });
  }

  function scheduleRender() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => renderLivePreview(), 200);
  }

  // ── Edit mode toggle ──
  function enterEditMode() {
    if (editing) return;
    editing = true;
    dom.classList.add('math-block-wrapper--editing');
    rendered.style.display = 'none';
    editorArea.style.display = 'block';
    renderLivePreview();

    // Focus and set cursor at end
    setTimeout(() => {
      const pos = getPos();
      if (pos != null) {
        const resolvedNode = view.state.doc.nodeAt(pos);
        if (resolvedNode) {
          const endPos = pos + resolvedNode.nodeSize - 1;
          try {
            const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, endPos));
            view.dispatch(tr);
          } catch {}
        }
      }
      view.focus();
    }, 10);
  }

  function exitEditMode() {
    if (!editing) return;
    editing = false;
    dom.classList.remove('math-block-wrapper--editing');
    editorArea.style.display = 'none';
    rendered.style.display = '';
    renderRenderedView();
  }

  // Click rendered view to enter edit mode
  rendered.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    enterEditMode();
  });

  // Click outside to exit edit mode
  const onDocClick = (e: MouseEvent) => {
    if (!editing) return;
    const target = e.target as HTMLElement;
    if (dom.contains(target)) return;
    exitEditMode();
  };
  document.addEventListener('mousedown', onDocClick);

  // Escape key to exit edit mode
  const onKeyDown = (e: KeyboardEvent) => {
    if (editing && e.key === 'Escape') {
      e.preventDefault();
      exitEditMode();
    }
  };
  dom.addEventListener('keydown', onKeyDown);

  // Watch contentDOM for text changes → live preview
  const observer = new MutationObserver(() => {
    if (editing) scheduleRender();
  });
  observer.observe(code, { childList: true, characterData: true, subtree: true });

  // Empty content → auto enter edit mode (e.g. created from SlashMenu)
  if (!initialNode.textContent.trim()) {
    setTimeout(() => enterEditMode(), 0);
  }

  // Lazy initial render (only if not editing)
  const blockObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting && !editing) {
        renderRenderedView();
        blockObserver.disconnect();
      }
    }
  }, { rootMargin: '200px' });
  blockObserver.observe(dom);

  return {
    dom,
    contentDOM: code,
    ignoreMutation(mutation: MutationRecord) {
      return !code.contains(mutation.target);
    },
    update(updatedNode) {
      if (updatedNode.type.name !== 'mathBlock') return false;
      node = updatedNode;
      if (editing) {
        if (renderTimer) clearTimeout(renderTimer);
        renderLivePreview();
      } else {
        renderRenderedView();
      }
      return true;
    },
    destroy() {
      blockObserver.disconnect();
      observer.disconnect();
      document.removeEventListener('mousedown', onDocClick);
      dom.removeEventListener('keydown', onKeyDown);
      if (renderTimer) clearTimeout(renderTimer);
    },
  };
};

export const mathBlockBlock: BlockDef = {
  name: 'mathBlock',
  group: 'block',
  nodeSpec: {
    content: 'text*',
    group: 'block',
    code: true,
    defining: true,
    marks: '',
    parseDOM: [{ tag: 'div.math-block-wrapper', preserveWhitespace: 'full' as const }],
    toDOM() { return ['div', { class: 'math-block-wrapper' }, ['pre', { class: 'math-block__code' }, 0]]; },
  },
  nodeView: mathBlockNodeView,
  capabilities: { canDelete: true, canDrag: true },
  slashMenu: { label: 'Math Block', icon: '∑', group: 'basic', keywords: ['math', 'latex', 'equation', '公式'], order: 10 },
};
