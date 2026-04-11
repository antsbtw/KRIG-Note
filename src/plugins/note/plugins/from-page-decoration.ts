import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

/**
 * FromPage Decoration Plugin
 *
 * 遍历文档中所有带 fromPage attr 的节点，
 * 给对应 DOM 元素添加 data-from-page 属性。
 * 用于 eBook↔Note 的翻页锚定同步。
 */

export const fromPageDecorationPlugin = new Plugin({
  props: {
    decorations(state) {
      const decorations: Decoration[] = [];

      state.doc.descendants((node, pos) => {
        const fromPage = node.attrs?.fromPage;
        if (fromPage != null && node.isBlock) {
          decorations.push(
            Decoration.node(pos, pos + node.nodeSize, {
              'data-from-page': String(fromPage),
            }),
          );
        }
      });

      return DecorationSet.create(state.doc, decorations);
    },
  },
});
