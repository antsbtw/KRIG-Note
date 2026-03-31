import type { BlockDef } from '../types';

export const paragraphBlock: BlockDef = {
  name: 'paragraph',
  group: 'block',

  nodeSpec: {
    content: 'inline*',
    group: 'block',
    parseDOM: [{ tag: 'p' }],
    toDOM() { return ['p', 0]; },
  },

  capabilities: {
    turnInto: ['heading', 'codeBlock', 'blockquote'],
    marks: ['bold', 'italic', 'strike', 'underline', 'code', 'link'],
    canIndent: true,
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
