import { Schema, type DOMOutputSpec } from 'prosemirror-model';

/**
 * Graph 编辑器的 PM schema（v1.3 § 4.2 P0+P1 子集）。
 *
 * 与 Note 的 schema **平行实现**，不依赖 Note 模块。
 *
 * Block 类型：
 * - textBlock（含 attrs.level 表示 paragraph/h1/h2/h3）
 * - mathBlock（独立公式）
 * - bulletList / orderedList → listItem
 *
 * Inline 类型：
 * - text
 * - mathInline
 * - hardBreak（段内换行）
 *
 * Mark 类型：
 * - bold / italic / underline / code
 *
 * 与序列化器的对应关系（src/lib/atom-serializers/svg/blocks/*）:
 * - textBlock.attrs.level → renderTextBlock 字号缩放
 * - mathInline / mathBlock attrs.tex → MathJax 渲染
 * - bulletList / orderedList → renderList 缩进 + bullet
 * - mark → font-loader.pickFontForChar 字体切换
 */

export const graphSchema = new Schema({
  nodes: {
    /** 顶层文档：允许多个 block-level 节点（textBlock/mathBlock/list） */
    doc: {
      content: 'block+',
    },

    /** textBlock：段落 / 标题（attrs.level = null|1|2|3） */
    textBlock: {
      content: 'inline*',
      group: 'block',
      attrs: {
        level: { default: null },
      },
      parseDOM: [
        { tag: 'p', attrs: { level: null } },
        { tag: 'h1', attrs: { level: 1 } },
        { tag: 'h2', attrs: { level: 2 } },
        { tag: 'h3', attrs: { level: 3 } },
      ],
      toDOM(node): DOMOutputSpec {
        const level = node.attrs.level as number | null;
        if (level === 1) return ['h1', 0];
        if (level === 2) return ['h2', 0];
        if (level === 3) return ['h3', 0];
        return ['p', 0];
      },
    },

    /** mathBlock：display 公式（占整行） */
    mathBlock: {
      group: 'block',
      atom: true,
      attrs: { tex: { default: '' } },
      parseDOM: [
        {
          tag: 'div[data-math-block]',
          getAttrs: (dom: HTMLElement) => ({ tex: dom.getAttribute('data-tex') ?? '' }),
        },
      ],
      toDOM(node): DOMOutputSpec {
        return ['div', { 'data-math-block': 'true', 'data-tex': node.attrs.tex }];
      },
    },

    /** bulletList：无序列表 */
    bulletList: {
      content: 'listItem+',
      group: 'block',
      parseDOM: [{ tag: 'ul' }],
      toDOM(): DOMOutputSpec {
        return ['ul', 0];
      },
    },

    /** orderedList：有序列表 */
    orderedList: {
      content: 'listItem+',
      group: 'block',
      parseDOM: [{ tag: 'ol' }],
      toDOM(): DOMOutputSpec {
        return ['ol', 0];
      },
    },

    /** listItem：列表项（可嵌套子 list） */
    listItem: {
      content: 'textBlock (textBlock | bulletList | orderedList)*',
      parseDOM: [{ tag: 'li' }],
      toDOM(): DOMOutputSpec {
        return ['li', 0];
      },
    },

    /** text：普通文字 */
    text: {
      group: 'inline',
    },

    /** mathInline：行内公式 */
    mathInline: {
      group: 'inline',
      inline: true,
      atom: true,
      attrs: { tex: { default: '' } },
      parseDOM: [
        {
          tag: 'span[data-math-inline]',
          getAttrs: (dom: HTMLElement) => ({ tex: dom.getAttribute('data-tex') ?? '' }),
        },
      ],
      toDOM(node): DOMOutputSpec {
        return ['span', { 'data-math-inline': 'true', 'data-tex': node.attrs.tex }];
      },
    },

    /** hardBreak：段内换行（Shift+Enter） */
    hardBreak: {
      group: 'inline',
      inline: true,
      selectable: false,
      parseDOM: [{ tag: 'br' }],
      toDOM(): DOMOutputSpec {
        return ['br'];
      },
    },
  },

  marks: {
    bold: {
      parseDOM: [{ tag: 'b' }, { tag: 'strong' }, { style: 'font-weight=bold' }],
      toDOM(): DOMOutputSpec {
        return ['strong', 0];
      },
    },
    italic: {
      parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }],
      toDOM(): DOMOutputSpec {
        return ['em', 0];
      },
    },
    underline: {
      parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }],
      toDOM(): DOMOutputSpec {
        return ['u', 0];
      },
    },
    code: {
      parseDOM: [{ tag: 'code' }],
      toDOM(): DOMOutputSpec {
        return ['code', 0];
      },
    },
  },
});
