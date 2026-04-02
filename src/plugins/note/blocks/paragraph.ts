import type { BlockDef } from '../types';

export const paragraphBlock: BlockDef = {
  name: 'paragraph',
  group: 'block',

  nodeSpec: {
    content: 'inline*',
    group: 'block',
    attrs: {
      indent: { default: 0 },
      textIndent: { default: false },
      align: { default: 'left' },
    },
    parseDOM: [{ tag: 'p' }],
    toDOM(node) {
      const indent = node.attrs.indent || 0;
      const textIndent = node.attrs.textIndent;
      const align = node.attrs.align || 'left';

      const styles: string[] = [];
      if (indent > 0) styles.push(`padding-left: ${indent * 24}px`);
      if (textIndent) styles.push('text-indent: 2em');
      if (align !== 'left') styles.push(`text-align: ${align}`);

      const attrs: Record<string, string> = {};
      if (styles.length > 0) attrs.style = styles.join('; ');

      return ['p', attrs, 0];
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
