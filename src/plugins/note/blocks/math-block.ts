import type { BlockDef, NodeViewFactory } from '../types';
import { TextSelection } from 'prosemirror-state';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { showMathPanel, hideMathPanel } from '../help-panel/latex';

/**
 * mathBlock — 块级数学公式（独立 Block）
 *
 * 性能优化：
 * - KaTeX 渲染结果缓存：LaTeX 未变化时跳过重复渲染
 * - 共享 IntersectionObserver：所有 mathBlock 实例复用一个 observer
 * - 全局 mousedown 监听去重：单一监听器管理所有编辑中的 mathBlock
 */

function renderKaTeX(target: HTMLElement, source: string) {
  const trimmed = source.trim();
  if (!trimmed) {
    target.innerHTML = '<div class="math-block__empty">Click to add a TeX equation</div>';
    return;
  }
  try {
    target.innerHTML = '';
    katex.render(trimmed, target, { throwOnError: false, displayMode: true, strict: false });
  } catch {
    target.innerHTML = '<div class="math-block__error">Invalid LaTeX</div>';
  }
}

// ── 共享 IntersectionObserver ──
// 所有 mathBlock 复用一个 observer，避免 N 个 block = N 个 observer

type LazyRenderCallback = () => void;
const lazyRenderCallbacks = new Map<Element, LazyRenderCallback>();

const sharedIntersectionObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      const cb = lazyRenderCallbacks.get(entry.target);
      if (cb) {
        cb();
        lazyRenderCallbacks.delete(entry.target);
        sharedIntersectionObserver.unobserve(entry.target);
      }
    }
  }
}, { rootMargin: '200px' });

// ── 共享全局 mousedown 监听 ──
// 单一监听器管理所有处于编辑模式的 mathBlock

interface ActiveMathEditor {
  dom: HTMLElement;
  exit: () => void;
}

const activeMathEditors = new Set<ActiveMathEditor>();

function onGlobalMouseDown(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (target.closest('.help-panel')) return;
  for (const editor of activeMathEditors) {
    if (!editor.dom.contains(target)) {
      editor.exit();
    }
  }
}

// 仅在有活跃编辑器时才挂载/卸载全局监听
function registerActiveEditor(editor: ActiveMathEditor) {
  if (activeMathEditors.size === 0) {
    document.addEventListener('mousedown', onGlobalMouseDown);
  }
  activeMathEditors.add(editor);
}

function unregisterActiveEditor(editor: ActiveMathEditor) {
  activeMathEditors.delete(editor);
  if (activeMathEditors.size === 0) {
    document.removeEventListener('mousedown', onGlobalMouseDown);
  }
}

const mathBlockNodeView: NodeViewFactory = (initialNode, view, getPos) => {
  let node = initialNode;
  let editing = false;
  let renderTimer: ReturnType<typeof setTimeout> | null = null;
  let lastRenderedLatex: string | null = null;
  let lastPreviewLatex: string | null = null;

  // ── DOM structure ──
  const dom = document.createElement('div');
  dom.classList.add('math-block-wrapper');

  const rendered = document.createElement('div');
  rendered.classList.add('math-block__rendered');
  rendered.setAttribute('contenteditable', 'false');
  dom.appendChild(rendered);

  const editorArea = document.createElement('div');
  editorArea.classList.add('math-block__editor');
  editorArea.style.display = 'none';

  const headerBar = document.createElement('div');
  headerBar.classList.add('math-block__header');
  headerBar.setAttribute('contenteditable', 'false');

  const label = document.createElement('span');
  label.classList.add('math-block__label');
  label.textContent = '∑ Block equation';
  headerBar.appendChild(label);
  editorArea.appendChild(headerBar);

  const code = document.createElement('pre');
  code.classList.add('math-block__code');
  editorArea.appendChild(code);

  const livePreview = document.createElement('div');
  livePreview.classList.add('math-block__preview');
  livePreview.setAttribute('contenteditable', 'false');
  editorArea.appendChild(livePreview);

  dom.appendChild(editorArea);

  // ── Helpers ──
  function getLatex(): string {
    return node.textContent;
  }

  function renderRenderedView() {
    const latex = getLatex();
    if (latex === lastRenderedLatex) return;
    lastRenderedLatex = latex;
    renderKaTeX(rendered, latex);
  }

  function renderLivePreview() {
    const latex = getLatex();
    if (latex === lastPreviewLatex) return;
    lastPreviewLatex = latex;
    requestAnimationFrame(() => {
      renderKaTeX(livePreview, latex);
    });
  }

  function scheduleRender() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => renderLivePreview(), 200);
  }

  // ── Edit mode ──
  const selfEditor: ActiveMathEditor = { dom, exit: () => exitEditMode() };

  function enterEditMode() {
    if (editing) return;
    editing = true;
    dom.classList.add('math-block-wrapper--editing');
    rendered.style.display = 'none';
    editorArea.style.display = 'block';
    lastPreviewLatex = null;  // 清除预览缓存，强制渲染
    renderLivePreview();

    showMathPanel((latex: string) => {
      const { state } = view;
      const tr = state.tr.insertText(latex, state.selection.from);
      view.dispatch(tr);
      view.focus();
    });

    registerActiveEditor(selfEditor);

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
    lastRenderedLatex = null;  // 清除渲染缓存，强制刷新
    renderRenderedView();
    hideMathPanel();
    unregisterActiveEditor(selfEditor);
  }

  rendered.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    enterEditMode();
  });

  const onKeyDown = (e: KeyboardEvent) => {
    if (editing && e.key === 'Escape') {
      e.preventDefault();
      exitEditMode();
    }
  };
  dom.addEventListener('keydown', onKeyDown);

  // Watch contentDOM for text changes → live preview
  const mutationObserver = new MutationObserver(() => {
    if (editing) scheduleRender();
  });
  mutationObserver.observe(code, { childList: true, characterData: true, subtree: true });

  // Empty content → auto enter edit mode
  if (!initialNode.textContent.trim()) {
    setTimeout(() => enterEditMode(), 0);
  }

  // Lazy initial render via shared observer
  lazyRenderCallbacks.set(dom, () => {
    if (!editing) renderRenderedView();
  });
  sharedIntersectionObserver.observe(dom);

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
        scheduleRender();  // 编辑中用防抖，不直接渲染
      } else {
        renderRenderedView();  // 缓存会跳过未变化的内容
      }
      return true;
    },
    destroy() {
      sharedIntersectionObserver.unobserve(dom);
      lazyRenderCallbacks.delete(dom);
      mutationObserver.disconnect();
      unregisterActiveEditor(selfEditor);
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
