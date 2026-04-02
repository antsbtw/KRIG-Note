import type { BlockDef, NodeViewFactory } from '../types';

/**
 * noteLink — 笔记间链接（inline atom）
 *
 * 渲染为可点击的链接：📄 目标笔记标题
 * 点击 → 在编辑器中打开目标 NoteFile
 * 通过 [[ 触发创建（由 plugin 处理），不在 SlashMenu 中
 */

declare const viewAPI: {
  noteOpenInEditor?: (callback: (noteId: string) => void) => void;
};

const noteLinkNodeView: NodeViewFactory = (node, view, _getPos) => {
  const dom = document.createElement('span');
  dom.classList.add('note-link');
  dom.contentEditable = 'false';

  const icon = document.createElement('span');
  icon.classList.add('note-link__icon');
  icon.textContent = '📄';

  const label = document.createElement('span');
  label.classList.add('note-link__label');
  label.textContent = node.attrs.label || '未命名';

  dom.appendChild(icon);
  dom.appendChild(label);

  // 点击打开目标笔记
  dom.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (node.attrs.noteId && typeof (window as any).viewAPI?.noteOpenInEditor === 'function') {
      // 通过与 NoteEditor 相同的方式打开笔记
      // 这里不能直接调用，因为 noteOpenInEditor 是 navSide 的 API
      // 改用自定义事件，让 NoteEditor 监听
      view.dom.dispatchEvent(new CustomEvent('note-link-click', {
        detail: { noteId: node.attrs.noteId },
      }));
    }
  });

  return {
    dom,
    update(updatedNode) {
      if (updatedNode.type.name !== 'noteLink') return false;
      label.textContent = updatedNode.attrs.label || '未命名';
      node = updatedNode;
      return true;
    },
    ignoreMutation() { return true; },
    selectNode() { dom.classList.add('note-link--selected'); },
    deselectNode() { dom.classList.remove('note-link--selected'); },
  };
};

export const noteLinkBlock: BlockDef = {
  name: 'noteLink',
  group: 'inline',

  nodeSpec: {
    inline: true,
    group: 'inline',
    atom: true,
    attrs: {
      noteId: {},
      label: { default: '' },
    },
    parseDOM: [{
      tag: 'span.note-link',
      getAttrs(dom: HTMLElement) {
        return {
          noteId: dom.getAttribute('data-note-id') || '',
          label: dom.textContent || '',
        };
      },
    }],
    toDOM(node) {
      return ['span', {
        class: 'note-link',
        'data-note-id': node.attrs.noteId,
      }, `📄 ${node.attrs.label || '未命名'}`];
    },
  },

  nodeView: noteLinkNodeView,

  capabilities: {},

  slashMenu: {
    label: 'Link to Note',
    icon: '📄',
    group: 'basic',
    keywords: ['note', 'link', 'page', 'notelink', 'reference', '链接', '笔记'],
    order: 13,
  },
};
