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
      indent: { default: 0 },
      align: { default: 'left' },
    },
    defining: true,
    parseDOM: [
      { tag: 'h1', attrs: { level: 1 } },
      { tag: 'h2', attrs: { level: 2 } },
      { tag: 'h3', attrs: { level: 3 } },
    ],
    toDOM(node) {
      const indent = node.attrs.indent || 0;
      const align = node.attrs.align || 'left';
      const tag = `h${node.attrs.level}`;
      const styles: string[] = [];
      if (indent > 0) styles.push(`padding-left: ${indent * 24}px`);
      if (align !== 'left') styles.push(`text-align: ${align}`);
      const attrs: Record<string, string> = {};
      if (styles.length > 0) attrs.style = styles.join('; ');
      return [tag, attrs, 0];
    },
  },

  capabilities: {
    turnInto: ['paragraph', 'codeBlock', 'blockquote'],
    marks: ['bold', 'italic', 'strike', 'underline', 'code', 'link'],
    canDelete: true,
    canDrag: true,
  },

  slashMenu: null,
};
