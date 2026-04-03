import type { BlockDef, NodeViewFactory } from '../types';

/**
 * textBlock — 文字流基类
 *
 * 合并了旧的 paragraph + heading + noteTitle。
 * 通过 attrs 变体决定视觉呈现：
 *   level: null → 段落，1/2/3 → H1/H2/H3
 *   isTitle: true → 文档标题（40px，不可删除）
 *   groupType → 视觉容器（bullet/ordered/task/callout/quote/toggle/frame）
 */

// ── NodeView（仅 noteTitle 需要，其他用 toDOM） ──

const noteTitleNodeView: NodeViewFactory = (node, _view, _getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('note-title');

  if (node.content.size === 0) dom.classList.add('is-empty');

  const contentDOM = document.createElement('h1');
  contentDOM.classList.add('note-title__content');
  dom.appendChild(contentDOM);

  return {
    dom,
    contentDOM,
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

      // 基类共享：排版
      indent: { default: 0 },
      textIndent: { default: false },
      align: { default: 'left' },

      // 基类共享：组合
      groupType: { default: null },
      groupAttrs: { default: null },
    },
    defining: true,
    parseDOM: [
      // noteTitle
      { tag: 'div.note-title', attrs: { isTitle: true }, priority: 60 },
      // headings
      { tag: 'h1', attrs: { level: 1 } },
      { tag: 'h2', attrs: { level: 2 } },
      { tag: 'h3', attrs: { level: 3 } },
      // paragraph（fallback）
      { tag: 'p' },
    ],
    toDOM: textBlockToDOM,
  },

  // NodeView 用于 noteTitle（isTitle=true）
  // 非 noteTitle 的 textBlock 不使用 NodeView，走 toDOM
  nodeView: undefined,

  capabilities: {
    turnInto: [],   // 转换通过改 attrs 实现，不是 turnInto
    marks: ['bold', 'italic', 'strike', 'underline', 'code', 'link'],
    canDuplicate: true,
    canDelete: true,
    canColor: true,
    canDrag: true,
  },

  enterBehavior: {
    action: 'split',
    exitCondition: 'empty-enter',
  },

  slashMenu: {
    label: 'Paragraph',
    icon: '¶',
    group: 'basic',
    order: 0,
  },
};

// ── noteTitle 专属 BlockDef（用于 doc content 表达式） ──
// noteTitle 是 textBlock 的特殊变体，但在 doc 的 content 中需要单独引用
// 解决方案：doc content = 'textBlock+'，第一个 textBlock 的 isTitle=true

// 导出 NodeView 供需要时直接使用
export { noteTitleNodeView };
