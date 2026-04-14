import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

/**
 * FromPage Decoration Plugin
 *
 * 遍历文档中所有带 fromPage attr 的节点，
 * 给对应 DOM 元素添加 data-from-page 属性。
 * 用于 eBook↔Note 的翻页锚定同步。
 */

const fromPageKey = new PluginKey('fromPageDecoration');

function buildFromPageDecorations(doc: import('prosemirror-model').Node): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    const fromPage = node.attrs?.fromPage;
    if (fromPage != null && node.isBlock) {
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, {
          'data-from-page': String(fromPage),
        }),
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}

export const fromPageDecorationPlugin = new Plugin({
  key: fromPageKey,

  state: {
    init(_, state) {
      return buildFromPageDecorations(state.doc);
    },
    apply(tr, value) {
      if (!tr.docChanged) return value;
      // fromPage attr 不会被用户编辑修改，只在文档结构变化时需要重映射
      return value.map(tr.mapping, tr.doc);
    },
  },

  props: {
    decorations(state) {
      return fromPageKey.getState(state);
    },
  },
});
