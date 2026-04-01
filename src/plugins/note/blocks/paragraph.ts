import type { BlockDef } from '../types';

export const paragraphBlock: BlockDef = {
  name: 'paragraph',
  group: 'block',

  nodeSpec: {
    content: 'inline*',
    group: 'block',
    attrs: { indent: { default: 0 } },
    parseDOM: [{ tag: 'p' }],
    toDOM(node) {
      const indent = node.attrs.indent || 0;
      return indent > 0
        ? ['p', { 'data-indent': indent, style: `padding-left: ${indent * 24}px` }, 0]
        : ['p', 0];
    },
  },

  capabilities: {
    turnInto: ['heading', 'codeBlock', 'blockquote'],
    marks: ['bold', 'italic', 'strike', 'underline', 'code', 'link'],
    canDuplicate: true,
    canDelete: true,
    canColor: true,
    canDrag: true,
  },

  slashMenu: {
    label: 'Paragraph',
    icon: '¶',
    group: 'basic',
    order: 0,
  },
};
