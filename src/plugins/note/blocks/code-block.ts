import type { BlockDef, NodeViewFactory } from '../types';
import { codeBlockKeyboardPlugin } from '../plugins/code-block-keyboard';

/**
 * codeBlock — 代码块（RenderBlock）
 *
 * 等宽字体，保留空格和换行。支持语言标识。
 * 简化版本：先不含 Mermaid 渲染和语法高亮。
 */

export const CODE_LANGUAGES = [
  '', 'javascript', 'typescript', 'python', 'rust', 'go', 'java', 'c', 'cpp',
  'html', 'css', 'json', 'yaml', 'toml', 'sql', 'bash', 'shell',
  'markdown', 'latex', 'mermaid', 'swift', 'kotlin', 'ruby', 'php',
];

function setLanguage(view: import('prosemirror-view').EditorView, getPos: () => number | undefined, lang: string) {
  const pos = getPos();
  if (pos === undefined) return;
  const node = view.state.doc.nodeAt(pos);
  if (!node) return;
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, language: lang }));
}

const codeBlockNodeView: NodeViewFactory = (node, view, getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('code-block');

  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.classList.add('code-block__toolbar');
  toolbar.setAttribute('contenteditable', 'false');

  // 语言选择器（点击 label → 显示输入框 + 下拉列表）
  const langWrapper = document.createElement('div');
  langWrapper.classList.add('code-block__lang-wrapper');

  const langLabel = document.createElement('span');
  langLabel.classList.add('code-block__lang');
  langLabel.textContent = node.attrs.language || 'Plain Text';
  langWrapper.appendChild(langLabel);

  const langInput = document.createElement('input');
  langInput.classList.add('code-block__lang-input');
  langInput.type = 'text';
  langInput.placeholder = 'Language...';
  langInput.style.display = 'none';

  const langDropdown = document.createElement('div');
  langDropdown.classList.add('code-block__lang-dropdown');
  langDropdown.style.display = 'none';

  function showSelector() {
    langLabel.style.display = 'none';
    langInput.style.display = '';
    langInput.value = node.attrs.language || '';
    langInput.focus();
    langInput.select();
    renderDropdown('');
    langDropdown.style.display = '';
  }

  function hideSelector() {
    langLabel.style.display = '';
    langInput.style.display = 'none';
    langDropdown.style.display = 'none';
  }

  function renderDropdown(filter: string) {
    langDropdown.innerHTML = '';
    const lower = filter.toLowerCase();
    const filtered = CODE_LANGUAGES.filter(l => !lower || l.includes(lower));
    for (const lang of filtered) {
      const item = document.createElement('div');
      item.classList.add('code-block__lang-item');
      item.textContent = lang || 'Plain Text';
      if (lang === (node.attrs.language || '')) item.classList.add('active');
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setLanguage(view, getPos, lang);
        hideSelector();
        view.focus();
      });
      langDropdown.appendChild(item);
    }
  }

  langLabel.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showSelector();
  });

  langInput.addEventListener('input', () => {
    renderDropdown(langInput.value);
  });

  langInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      setLanguage(view, getPos, langInput.value.trim());
      hideSelector();
      view.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hideSelector();
      view.focus();
    }
  });

  langInput.addEventListener('blur', () => {
    // 延迟关闭，让 dropdown mousedown 先触发
    setTimeout(hideSelector, 150);
  });

  langWrapper.appendChild(langInput);
  langWrapper.appendChild(langDropdown);
  toolbar.appendChild(langWrapper);

  const spacer = document.createElement('div');
  spacer.style.flex = '1';
  toolbar.appendChild(spacer);

  // 复制按钮
  const copyBtn = document.createElement('button');
  copyBtn.classList.add('code-block__toolbar-btn');
  copyBtn.innerHTML = '📋';
  copyBtn.title = '复制代码';
  copyBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(code.textContent || '').catch(() => {});
  });
  toolbar.appendChild(copyBtn);

  dom.appendChild(toolbar);

  // 代码区
  const pre = document.createElement('pre');
  pre.classList.add('code-block__pre');
  const code = document.createElement('code');
  pre.appendChild(code);
  dom.appendChild(pre);

  return {
    dom,
    contentDOM: code,
    update(updatedNode) {
      if (updatedNode.type.name !== 'codeBlock') return false;
      if (updatedNode.attrs.language !== node.attrs.language) {
        langLabel.textContent = updatedNode.attrs.language || 'Plain Text';
      }
      node = updatedNode;
      return true;
    },
    stopEvent(event: Event) {
      if (event.type === 'contextmenu') return false;
      if (toolbar.contains(event.target as Node)) return true;
      return false;
    },
    ignoreMutation(mutation) {
      return toolbar.contains(mutation.target as Node);
    },
  };
};

export const codeBlockBlock: BlockDef = {
  name: 'codeBlock',
  group: 'block',
  nodeSpec: {
    content: 'text*',
    group: 'block',
    code: true,
    defining: true,
    marks: '',
    attrs: { language: { default: '' } },
    parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' as const, getAttrs(dom: HTMLElement) {
      return { language: dom.getAttribute('data-language') || '' };
    }}],
    toDOM(node) { return ['pre', { 'data-language': node.attrs.language }, ['code', 0]]; },
  },
  nodeView: codeBlockNodeView,
  plugin: codeBlockKeyboardPlugin,
  enterBehavior: { action: 'newline', exitCondition: 'double-enter' },
  capabilities: { turnInto: ['textBlock'], canDelete: true, canDrag: true },
  slashMenu: { label: 'Code Block', icon: '</>', group: 'basic', keywords: ['code', 'pre', '代码'], order: 4 },
};
