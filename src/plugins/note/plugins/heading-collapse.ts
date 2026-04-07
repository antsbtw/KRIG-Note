/**
 * heading-collapse — Heading 折叠/展开 Plugin
 *
 * 读取 textBlock 的 open 属性（true=展开，false=折叠），
 * 用 Decoration 隐藏折叠范围内的节点，并在 heading 底部显示省略号指示器。
 *
 * 折叠范围推导：
 *   H1: 到下一个 H1 或文档末尾
 *   H2: 到下一个 H2/H1 或文档末尾
 *   H3: 到下一个 H3/H2/H1 或文档末尾
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export const headingCollapseKey = new PluginKey('headingCollapse');

/** 切换 heading 的折叠状态 */
export function toggleHeadingCollapse(view: import('prosemirror-view').EditorView, pos: number): void {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type.name !== 'textBlock' || !node.attrs.level) return;
  const open = node.attrs.open;
  view.dispatch(
    view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, open: !open }),
  );
}

/** 展开所有 heading */
export function expandAllHeadings(view: import('prosemirror-view').EditorView): void {
  const tr = view.state.tr;
  let changed = false;
  view.state.doc.forEach((node, offset) => {
    if (node.type.name === 'textBlock' && node.attrs.level && node.attrs.open === false) {
      tr.setNodeMarkup(offset, undefined, { ...node.attrs, open: true });
      changed = true;
    }
  });
  if (changed) view.dispatch(tr);
}

/** 折叠所有 heading */
export function collapseAllHeadings(view: import('prosemirror-view').EditorView): void {
  const tr = view.state.tr;
  let changed = false;
  view.state.doc.forEach((node, offset) => {
    if (node.type.name === 'textBlock' && node.attrs.level && !node.attrs.isTitle && node.attrs.open !== false) {
      tr.setNodeMarkup(offset, undefined, { ...node.attrs, open: false });
      changed = true;
    }
  });
  if (changed) view.dispatch(tr);
}

/**
 * 展开到指定级别
 *   level=1: 只看到 H1（H1 折叠，H2/H3 被 H1 隐藏）
 *   level=2: 看到 H1+H2（H1 展开，H2 折叠，H3 被 H2 隐藏）
 *   level=3: 看到 H1+H2+H3（H1/H2 展开，H3 折叠，正文隐藏）
 *   level=Infinity: 全部展开
 */
export function expandToLevel(view: import('prosemirror-view').EditorView, level: number): void {
  const tr = view.state.tr;
  let changed = false;
  view.state.doc.forEach((node, offset) => {
    if (node.type.name !== 'textBlock' || !node.attrs.level || node.attrs.isTitle) return;
    // level < 目标值的 heading 展开，level >= 目标值的 heading 折叠
    const shouldOpen = level === Infinity || node.attrs.level < level;
    const isOpen = node.attrs.open !== false;
    if (shouldOpen !== isOpen) {
      tr.setNodeMarkup(offset, undefined, { ...node.attrs, open: shouldOpen });
      changed = true;
    }
  });
  if (changed) view.dispatch(tr);
}

/**
 * 获取当前展开级别（用于高亮按钮）
 *   返回 1/2/3/Infinity
 */
export function getCurrentExpandLevel(view: import('prosemirror-view').EditorView): number {
  let hasAnyHeading = false;
  let allOpen = true;
  // 找到最小的被折叠的 heading level
  let minCollapsedLevel = 4; // > 3
  view.state.doc.forEach((node) => {
    if (node.type.name !== 'textBlock' || !node.attrs.level || node.attrs.isTitle) return;
    hasAnyHeading = true;
    if (node.attrs.open === false) {
      allOpen = false;
      if (node.attrs.level < minCollapsedLevel) {
        minCollapsedLevel = node.attrs.level;
      }
    }
  });
  if (!hasAnyHeading || allOpen) return Infinity;
  // minCollapsedLevel 就是当前展开级别
  // 例：H1 折叠 → minCollapsedLevel=1 → 当前级别=1（只看到 H1）
  return minCollapsedLevel;
}

/**
 * 确保指定 heading 可见（展开它自身 + 所有隐藏它的上级 heading）
 * @param pos heading 在 doc 中的位置
 */
export function ensureHeadingVisible(view: import('prosemirror-view').EditorView, pos: number): void {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type.name !== 'textBlock' || !node.attrs.level) return;

  const targetLevel = node.attrs.level;
  const tr = view.state.tr;
  let changed = false;

  // 1. 展开目标自身
  if (node.attrs.open === false) {
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, open: true });
    changed = true;
  }

  // 2. 找出所有可能隐藏目标的上级 heading（level < targetLevel 且在目标之前且 open=false）
  //    从文档开头遍历，找到每个 level < targetLevel 的折叠 heading，
  //    检查其折叠范围是否包含目标 pos
  view.state.doc.forEach((n, offset) => {
    if (offset >= pos) return; // 只看目标之前的节点
    if (n.type.name !== 'textBlock' || !n.attrs.level || n.attrs.isTitle) return;
    if (n.attrs.level >= targetLevel) return; // 只看更高级别
    if (n.attrs.open !== false) return; // 已展开的不需要处理

    // 检查这个 heading 的折叠范围是否包含目标
    const hEnd = offset + n.nodeSize;
    // 找折叠范围终点
    let rangeEnd = view.state.doc.content.size;
    view.state.doc.forEach((nn, oo) => {
      if (oo <= offset) return;
      if (oo < rangeEnd && nn.type.name === 'textBlock' && nn.attrs.level && !nn.attrs.isTitle && nn.attrs.level <= n.attrs.level) {
        rangeEnd = oo;
      }
    });

    if (pos >= hEnd && pos < rangeEnd) {
      // 目标在这个 heading 的折叠范围内，展开它
      tr.setNodeMarkup(offset, undefined, { ...n.attrs, open: true });
      changed = true;
    }
  });

  if (changed) view.dispatch(tr);
}

/**
 * 计算所有折叠的 heading 的隐藏范围
 * 返回 { hiddenRanges: [from, to][], ellipsisPositions: pos[] }
 */
function computeCollapseRanges(doc: import('prosemirror-model').Node) {
  const hiddenRanges: [number, number][] = [];
  const ellipsisPositions: number[] = []; // heading 节点的末尾 pos

  // 收集所有顶层节点的 heading 信息
  interface HeadingInfo {
    pos: number;
    level: number;
    open: boolean;
    endPos: number; // pos + nodeSize
  }

  const headings: HeadingInfo[] = [];
  const allNodes: { pos: number; endPos: number }[] = [];

  doc.forEach((node, offset) => {
    allNodes.push({ pos: offset, endPos: offset + node.nodeSize });
    if (node.type.name === 'textBlock' && node.attrs.level && !node.attrs.isTitle) {
      headings.push({
        pos: offset,
        level: node.attrs.level,
        open: node.attrs.open !== false, // default true
        endPos: offset + node.nodeSize,
      });
    }
  });

  // 第一轮：为每个折叠的 heading 计算折叠范围
  interface CollapseRange {
    headingPos: number;
    rangeStart: number;
    rangeEnd: number;
  }
  const ranges: CollapseRange[] = [];

  for (const h of headings) {
    if (h.open) continue;

    const rangeStart = h.endPos;
    let rangeEnd = doc.content.size;

    for (const info of allNodes) {
      if (info.pos <= h.pos) continue;
      const node = doc.nodeAt(info.pos);
      if (
        node &&
        node.type.name === 'textBlock' &&
        node.attrs.level &&
        !node.attrs.isTitle &&
        node.attrs.level <= h.level
      ) {
        rangeEnd = info.pos;
        break;
      }
    }

    if (rangeStart < rangeEnd) {
      ranges.push({ headingPos: h.pos, rangeStart, rangeEnd });
    }
  }

  // 第二轮：排除被上级折叠范围包含的 heading（不为它们生成省略号）
  for (const r of ranges) {
    hiddenRanges.push([r.rangeStart, r.rangeEnd]);

    // 检查这个 heading 是否被某个更大范围包含
    const isHiddenByParent = ranges.some(
      (other) => other !== r && other.rangeStart <= r.headingPos && r.headingPos < other.rangeEnd,
    );
    if (!isHiddenByParent) {
      ellipsisPositions.push(r.headingPos);
    }
  }

  return { hiddenRanges, ellipsisPositions };
}

export function headingCollapsePlugin() {
  return new Plugin({
    key: headingCollapseKey,

    state: {
      init(_, state) {
        return computeCollapseRanges(state.doc);
      },
      apply(tr, value, _oldState, newState) {
        if (tr.docChanged) {
          return computeCollapseRanges(newState.doc);
        }
        return value;
      },
    },

    props: {
      decorations(state) {
        const { hiddenRanges, ellipsisPositions } = headingCollapseKey.getState(state);
        const decorations: Decoration[] = [];

        // 隐藏折叠范围内的节点
        for (const [from, to] of hiddenRanges) {
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (pos >= from && pos < to) {
              const nodeEnd = pos + node.nodeSize;
              if (nodeEnd <= to) {
                decorations.push(
                  Decoration.node(pos, nodeEnd, {
                    class: 'heading-collapsed-hidden',
                  }),
                );
              }
              return false;
            }
            return true;
          });
        }

        // 给折叠的 heading 加底部虚线样式
        for (const headingPos of ellipsisPositions) {
          const headingNode = state.doc.nodeAt(headingPos);
          if (headingNode) {
            decorations.push(
              Decoration.node(headingPos, headingPos + headingNode.nodeSize, {
                class: 'heading-collapsed',
              }),
            );
          }
        }

        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}
