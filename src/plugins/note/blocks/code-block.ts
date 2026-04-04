import type { BlockDef, NodeViewFactory } from '../types';

/**
 * codeBlock — 代码块（RenderBlock）
 *
 * 等宽字体，保留空格和换行。支持语言标识。
 * 简化版本：先不含 Mermaid 渲染和语法高亮。
 */

const codeBlockNodeView: NodeViewFactory = (node, view, getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('code-block');

  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.classList.add('code-block__toolbar');
  toolbar.setAttribute('contenteditable', 'false');

  const langLabel = document.createElement('span');
  langLabel.classList.add('code-block__lang');
  langLabel.textContent = node.attrs.language || 'Plain Text';
  toolbar.appendChild(langLabel);

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
  enterBehavior: { action: 'newline', exitCondition: 'double-enter' },
  capabilities: { turnInto: ['textBlock'], canDelete: true, canDrag: true },
  slashMenu: { label: 'Code Block', icon: '</>', group: 'basic', keywords: ['code', 'pre', '代码'], order: 4 },
};
