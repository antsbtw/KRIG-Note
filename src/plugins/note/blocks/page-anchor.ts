import type { BlockDef } from '../types';

/**
 * PageAnchor — PDF 页面锚点
 *
 * 在 Note 中标记 PDF 页码位置，用于 PDF↔Note 双向滚动同步。
 * 渲染为轻量的页码标识行，带 data-pdf-page 属性。
 */
export const pageAnchorBlock: BlockDef = {
  name: 'pageAnchor',
  group: 'block',
  nodeSpec: {
    group: 'block',
    atom: true,
    attrs: {
      pdfPage: { default: 0 },
      label: { default: '' },
    },
    parseDOM: [{
      tag: 'div.page-anchor',
      getAttrs(dom: HTMLElement) {
        return {
          pdfPage: parseInt(dom.getAttribute('data-pdf-page') || '0', 10),
          label: dom.getAttribute('data-label') || '',
        };
      },
    }],
    toDOM(node: any) {
      const page = node.attrs.pdfPage;
      const label = node.attrs.label || `p.${page}`;
      return ['div', {
        class: 'page-anchor',
        'data-pdf-page': String(page),
        'data-label': label,
        contenteditable: 'false',
      }, label];
    },
  },
  capabilities: { canDelete: true, canDrag: false },
};
