import type { BlockDef } from '../types';

/**
 * heading — 标题（H1-H3）
 *
 * 自带 toggle 能力（open attr），但无 NodeView——纯文本渲染。
 * 折叠通过 Handle 菜单 "Fold/Unfold" 操作。
 * 折叠范围由 headingFoldPlugin 自动推导。
 */

export const headingBlock: BlockDef = {
  name: 'heading',
  group: 'block',

  nodeSpec: {
    content: 'inline*',
    group: 'block',
    attrs: {
      level: { default: 1 },
      open: { default: true },
    },
    defining: true,
    parseDOM: [
      { tag: 'h1', attrs: { level: 1 } },
      { tag: 'h2', attrs: { level: 2 } },
      { tag: 'h3', attrs: { level: 3 } },
    ],
    toDOM(node) { return [`h${node.attrs.level}`, 0]; },
  },

  capabilities: {
    turnInto: ['paragraph', 'codeBlock', 'blockquote'],
    marks: ['bold', 'italic', 'strike', 'underline', 'code', 'link'],
    canIndent: true,
    canDelete: true,
    canDrag: true,
  },

  slashMenu: null,
};
