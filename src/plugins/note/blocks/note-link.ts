import type { BlockDef, NodeViewFactory } from '../types';

/**
 * noteLink — 笔记内链（Inline atom）
 *
 * 渲染为可点击链接，显示目标 NoteFile 的标题。
 * 点击 → 在当前 NoteView 中打开目标 NoteFile。
 * 目标不存在 → 红色 "未找到"。
 * 标题从目标 NoteFile 的 noteTitle 自动派生。
 */

const api = () => (window as any).viewAPI as {
  noteLoad: (id: string) => Promise<any>;
  noteList: () => Promise<{ id: string; title: string }[]>;
  noteOpenInEditor: (id: string) => Promise<void>;
} | undefined;

const noteLinkNodeView: NodeViewFactory = (node, view, getPos) => {
  const dom = document.createElement('span');
  dom.classList.add('note-link');
  dom.setAttribute('contenteditable', 'false');

  let currentNoteId = node.attrs.noteId as string;
  let currentLabel = node.attrs.label as string;

  function render(label: string, exists: boolean) {
    dom.textContent = exists ? `📄 ${label || 'Untitled'}` : `📄 ${label || currentNoteId || '?'} (未找到)`;
    dom.classList.toggle('note-link--missing', !exists);
  }

  // 初始渲染 + 异步验证目标是否存在，同时自动派生标题
  async function validate() {
    const v = api();
    if (!v || !currentNoteId) {
      render(currentLabel, false);
      return;
    }
    try {
      const record = await v.noteLoad(currentNoteId);
      if (record) {
        const liveTitle = record.title || '';
        render(liveTitle, true);
        // 如果标题变了，同步更新 label attr
        if (liveTitle && liveTitle !== currentLabel) {
          const pos = getPos();
          if (pos != null) {
            const tr = view.state.tr.setNodeAttribute(pos, 'label', liveTitle);
            view.dispatch(tr);
            currentLabel = liveTitle;
          }
        }
      } else {
        render(currentLabel, false);
      }
    } catch {
      render(currentLabel, false);
    }
  }

  // 先用本地 label 渲染，然后异步校验
  render(currentLabel, true);
  validate();

  // 点击 → 打开目标笔记
  dom.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!currentNoteId) return;
    const v = api();
    if (v?.noteOpenInEditor) {
      v.noteOpenInEditor(currentNoteId);
    }
  });

  return {
    dom,
    update(updatedNode) {
      if (updatedNode.type.name !== 'noteLink') return false;
      const newId = updatedNode.attrs.noteId as string;
      const newLabel = updatedNode.attrs.label as string;
      if (newId !== currentNoteId || newLabel !== currentLabel) {
        currentNoteId = newId;
        currentLabel = newLabel;
        render(currentLabel, true);
        validate();
      }
      return true;
    },
    stopEvent() { return true; },
    ignoreMutation() { return true; },
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
    parseDOM: [{ tag: 'span.note-link', getAttrs(dom: HTMLElement) {
      return { noteId: dom.getAttribute('data-note-id') || '', label: dom.textContent?.replace(/^📄\s*/, '') || '' };
    }}],
    toDOM(node) {
      return ['span', { class: 'note-link', 'data-note-id': node.attrs.noteId }, `📄 ${node.attrs.label || 'Untitled'}`];
    },
  },
  nodeView: noteLinkNodeView,
  capabilities: {},
  slashMenu: null, // 通过 [[ 触发，不在 SlashMenu 中
};
