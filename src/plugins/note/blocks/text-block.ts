import type { BlockDef, NodeViewFactory } from '../types';

/**
 * TextBlock — 文字流基类
 *
 * 编辑器中最基础的 Block。通过 attrs 变体实现：
 *   level: null → 段落，1/2/3 → H1/H2/H3
 *   isTitle: true → 文档标题（40px，不可删除）
 */

// ── NodeView（仅 noteTitle 需要，其他用 toDOM） ──

const noteTitleNodeView: NodeViewFactory = (node, _view, _getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('note-title');

  const content = document.createElement('h1');
  content.classList.add('note-title__content');
  dom.appendChild(content);

  if (node.content.size === 0) dom.classList.add('is-empty');

  return {
    dom,
    contentDOM: content,
    update(updatedNode) {
      if (updatedNode.type.name !== 'textBlock') return false;
      if (!updatedNode.attrs.isTitle) return false;
      dom.classList.toggle('is-empty', updatedNode.content.size === 0);
      return true;
    },
  };
};

// ── toDOM：根据 attrs 决定渲染标签 ──

function textBlockToDOM(node: any): any {
  const { level, isTitle, indent, textIndent, align } = node.attrs;

  // noteTitle 由 NodeView 处理
  if (isTitle) {
    return ['div', { class: 'note-title' }, ['h1', { class: 'note-title__content' }, 0]];
  }

  // 构建 style
  const styles: string[] = [];
  if (indent > 0) styles.push(`padding-left: ${indent * 24}px`);
  if (textIndent) styles.push('text-indent: 2em');
  if (align && align !== 'left') styles.push(`text-align: ${align}`);

  const attrs: Record<string, string> = {};
  if (styles.length > 0) attrs.style = styles.join('; ');

  // heading
  if (level === 1) return ['h1', attrs, 0];
  if (level === 2) return ['h2', attrs, 0];
  if (level === 3) return ['h3', attrs, 0];

  // paragraph
  return ['p', attrs, 0];
}

// ── BlockDef ──

export const textBlockDef: BlockDef = {
  name: 'textBlock',
  group: 'block',

  nodeSpec: {
    content: 'inline*',
    group: 'block',
    attrs: {
      // TextBlock 专属
      level: { default: null },         // null=paragraph, 1/2/3=heading
      isTitle: { default: false },       // true=文档标题
      open: { default: true },           // heading 折叠状态

      // 排版
      indent: { default: 0 },
      textIndent: { default: false },
      align: { default: 'left' },
    },
    defining: true,
    parseDOM: [
      // noteTitle
      { tag: 'div.note-title', attrs: { isTitle: true }, priority: 60 },
      // headings
      { tag: 'h1', attrs: { level: 1 } },
      { tag: 'h2', attrs: { level: 2 } },
      { tag: 'h3', attrs: { level: 3 } },
      // paragraph
      { tag: 'p' },
    ],
    toDOM: textBlockToDOM,
  },

  // NodeView 仅用于 noteTitle
  nodeView: undefined,

  capabilities: {
    turnInto: [],
    marks: ['bold', 'italic', 'underline', 'strike', 'code', 'link', 'textStyle', 'highlight'],
    canDuplicate: true,
    canDelete: true,
    canColor: true,
    canDrag: true,
  } as any,

  enterBehavior: undefined, // TextBlock 的 Enter 由 baseKeymap splitBlock 处理

  slashMenu: {
    label: 'Paragraph',
    icon: '¶',
    group: 'basic',
    keywords: ['paragraph', 'text', 'plain', '段落'],
    order: 0,
  },
};

// 导出 NodeView 供 NoteEditor 中根据 isTitle 条件使用
export { noteTitleNodeView };
