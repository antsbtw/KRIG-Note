import { Plugin } from 'prosemirror-state';

/**
 * 格式继承插件
 *
 * 当 Enter 创建新 paragraph 时，继承上一个 paragraph 的 textIndent 和 align。
 * 这样用户设置一次首行缩进后，后续段落自动保持。
 */

export function formatInheritPlugin(): Plugin {
  return new Plugin({
    appendTransaction(transactions, oldState, newState) {
      // 只在文档变化时检查
      if (!transactions.some((tr) => tr.docChanged)) return null;

      const { $from } = newState.selection;
      // 当前光标所在节点必须是 paragraph
      if ($from.parent.type.name !== 'textBlock') return null;
      // 且是空段落（刚创建的）
      if ($from.parent.content.size > 0) return null;

      // 找上一个 sibling paragraph
      const parentNode = $from.node($from.depth - 1);
      const indexInParent = $from.index($from.depth - 1);
      if (indexInParent <= 0) return null;

      const prevNode = parentNode.child(indexInParent - 1);
      if (prevNode.type.name !== 'textBlock') return null;

      // 检查是否需要继承
      const textIndent = prevNode.attrs.textIndent;
      const align = prevNode.attrs.align;

      if (!textIndent && (!align || align === 'left')) return null;

      // 当前 paragraph 已经有这些 attrs 了就跳过
      const currentNode = $from.parent;
      if (currentNode.attrs.textIndent === textIndent && currentNode.attrs.align === align) return null;

      // 设置 attrs
      const pos = $from.before($from.depth);
      const tr = newState.tr.setNodeMarkup(pos, undefined, {
        ...currentNode.attrs,
        textIndent,
        align,
      });

      return tr;
    },
  });
}
