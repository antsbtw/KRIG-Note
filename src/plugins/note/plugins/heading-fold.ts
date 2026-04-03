import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

/**
 * Heading Fold Plugin — 标题折叠自动推导
 *
 * 推导规则：
 * H1 折叠范围 = 到下一个 H1 或文档末尾
 * H2 折叠范围 = 到下一个 H1/H2 或文档末尾
 * H3 折叠范围 = 到下一个 H1/H2/H3 或文档末尾
 *
 * 折叠的 heading 添加视觉提示（ ··· 标记）。
 */

export const headingFoldKey = new PluginKey('headingFold');

export function headingFoldPlugin(): Plugin {
  return new Plugin({
    key: headingFoldKey,

    props: {
      decorations(state) {
        const doc = state.doc;
        const decorations: Decoration[] = [];

        // 第一步：收集所有顶层节点的位置和类型
        interface TopNode { pos: number; nodeSize: number; isHeading: boolean; level: number; open: boolean }
        const topNodes: TopNode[] = [];

        doc.forEach((node, pos) => {
          topNodes.push({
            pos,
            nodeSize: node.nodeSize,
            isHeading: node.type.name === 'textBlock' && !!node.attrs.level,
            level: (node.type.name === 'textBlock' && node.attrs.level) ? node.attrs.level : 0,
            open: (node.type.name === 'textBlock' && node.attrs.level) ? (node.attrs.open !== false) : true,
          });
        });

        // 第二步：对每个折叠的 heading，找到其管辖范围
        for (let i = 0; i < topNodes.length; i++) {
          const node = topNodes[i];
          if (!node.isHeading || node.open) continue;

          const foldLevel = node.level;

          // 从下一个节点开始，找到折叠范围的结束
          for (let j = i + 1; j < topNodes.length; j++) {
            const sibling = topNodes[j];

            // 遇到同级或更高级 heading → 停止
            if (sibling.isHeading && sibling.level <= foldLevel) {
              break;
            }

            // 隐藏这个节点
            decorations.push(
              Decoration.node(sibling.pos, sibling.pos + sibling.nodeSize, {
                style: 'display: none',
              }),
            );
          }

          // 给折叠的 heading 添加视觉提示
          decorations.push(
            Decoration.node(node.pos, node.pos + node.nodeSize, {
              class: 'heading--folded',
            }),
          );
        }

        if (decorations.length === 0) return DecorationSet.empty;
        return DecorationSet.create(doc, decorations);
      },
    },
  });
}
