import type { BlockDef } from '../types';

export const headingBlock: BlockDef = {
  name: 'heading',
  group: 'block',

  nodeSpec: {
    content: 'inline*',
    group: 'block',
    attrs: { level: { default: 1 } },
    parseDOM: [
      { tag: 'h1', attrs: { level: 1 } },
      { tag: 'h2', attrs: { level: 2 } },
      { tag: 'h3', attrs: { level: 3 } },
      { tag: 'h4', attrs: { level: 4 } },
      { tag: 'h5', attrs: { level: 5 } },
      { tag: 'h6', attrs: { level: 6 } },
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

  slashMenu: null, // heading 通过独立的 H1-H6 项注册，不作为单独一项
};

// Heading 的 SlashMenu 项按级别分开注册
export const headingSlashItems = [1, 2, 3, 4, 5, 6].map((level) => ({
  id: `heading${level}`,
  label: `Heading ${level}`,
  icon: `H${level}`,
  group: 'basic',
  keywords: [`h${level}`, `heading${level}`],
  order: level,
  blockName: 'heading',
  attrs: { level },
}));
