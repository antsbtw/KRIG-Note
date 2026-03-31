import type { BlockDef } from '../types';

export const codeBlockBlock: BlockDef = {
  name: 'codeBlock',
  group: 'block',

  nodeSpec: {
    content: 'text*',
    group: 'block',
    code: true,
    defining: true,
    marks: '',
    attrs: { language: { default: '' } },
    parseDOM: [{ tag: 'pre', preserveWhitespace: 'full', getAttrs(dom: HTMLElement) {
      return { language: dom.getAttribute('data-language') || '' };
    }}],
    toDOM(node) {
      return ['pre', { 'data-language': node.attrs.language }, ['code', 0]];
    },
  },

  capabilities: {
    turnInto: ['paragraph'],
    marks: [],
    canDuplicate: true,
    canDelete: true,
    canDrag: true,
  },

  slashMenu: {
    label: 'Code Block',
    icon: '< >',
    group: 'code',
    keywords: ['code', 'pre', 'program'],
    order: 0,
  },
};
