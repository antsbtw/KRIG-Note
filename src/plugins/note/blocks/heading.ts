import type { BlockDef } from '../types';

/**
 * heading — 标题（H1-H3）
 *
 * 只支持三级标题。更深层级用 toggleHeading 或缩进。
 */

export const headingBlock: BlockDef = {
  name: 'heading',
  group: 'block',

  nodeSpec: {
    content: 'inline*',
    group: 'block',
    attrs: { level: { default: 1 } },
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
    canDuplicate: true,
    canDelete: true,
    canDrag: true,
  },

  // heading 按级别单独注册 SlashMenu（见 blocks/index.ts）
  slashMenu: null,
};
