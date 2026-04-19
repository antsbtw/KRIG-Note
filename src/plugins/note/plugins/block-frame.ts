/**
 * block-frame plugin — 通用 Block 框定渲染
 *
 * 基于 node attrs (frameColor, frameStyle, frameGroupId) 构建 Decoration，
 * 为 block 节点添加边框视觉效果。
 *
 * 支持：
 * - 单 block 框定（四边圆角）
 * - 多 block 分组框定（首/中/尾圆角）
 * - 自定义颜色 + 单线/双线
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

export const blockFramePluginKey = new PluginKey('blockFrame');

/** 框定颜色预设（参考 Notion） */
export const FRAME_COLORS = [
  { name: 'Gray', color: '#787774' },
  { name: 'Brown', color: '#9F6B53' },
  { name: 'Orange', color: '#D9730D' },
  { name: 'Yellow', color: '#CB912F' },
  { name: 'Green', color: '#448361' },
  { name: 'Blue', color: '#337EA9' },
  { name: 'Purple', color: '#9065B0' },
  { name: 'Pink', color: '#C14C8A' },
  { name: 'Red', color: '#D44C47' },
] as const;

/** 框定样式选项 */
export const FRAME_STYLES = [
  { name: '单线', value: 'solid' as const },
  { name: '双线', value: 'double' as const },
] as const;

export function blockFramePlugin(): Plugin {
  return new Plugin({
    key: blockFramePluginKey,

    state: {
      init(_, state) {
        return buildBlockFrameDecorations(state.doc);
      },
      apply(tr, value, _oldState, newState) {
        if (!tr.docChanged) return value;
        return buildBlockFrameDecorations(newState.doc);
      },
    },

    props: {
      decorations(state) {
        return blockFramePluginKey.getState(state);
      },
    },
  });
}

/**
 * 构建 block 框定的 node decorations
 *
 * 扫描文档中所有带 frameColor 的 block 节点，
 * 按 frameGroupId 分组连续 block，给每个 block 添加框定样式。
 */
function buildBlockFrameDecorations(doc: PMNode): DecorationSet {
  const framedBlocks: {
    pos: number;
    size: number;
    color: string;
    style: string;
    groupId: string | null;
  }[] = [];

  doc.forEach((node, offset) => {
    if (!node.isBlock) return;
    const { frameColor, frameStyle, frameGroupId } = node.attrs;
    if (!frameColor) return;
    framedBlocks.push({
      pos: offset,
      size: node.nodeSize,
      color: frameColor,
      style: frameStyle || 'solid',
      groupId: frameGroupId || null,
    });
  });

  if (framedBlocks.length === 0) return DecorationSet.empty;

  // 按 frameGroupId 分组
  const groups = new Map<string, typeof framedBlocks>();
  const ungrouped: typeof framedBlocks = [];

  for (const fb of framedBlocks) {
    if (fb.groupId) {
      const list = groups.get(fb.groupId) || [];
      list.push(fb);
      groups.set(fb.groupId, list);
    } else {
      ungrouped.push(fb);
    }
  }

  const decorations: Decoration[] = [];

  // 无分组的 block — 每个都是 'only'
  for (const fb of ungrouped) {
    decorations.push(
      Decoration.node(fb.pos, fb.pos + fb.size, {
        class: `block-frame block-frame--only`,
        style: `--frame-color: ${fb.color}; --frame-style: ${fb.style};`,
      }),
    );
  }

  // 有分组的 block — 首/中/尾
  for (const [, blocks] of groups) {
    const count = blocks.length;
    const color = blocks[0].color;
    const style = blocks[0].style;

    blocks.forEach((fb, i) => {
      let position: string;
      if (count === 1) {
        position = 'only';
      } else if (i === 0) {
        position = 'first';
      } else if (i === count - 1) {
        position = 'last';
      } else {
        position = 'middle';
      }

      decorations.push(
        Decoration.node(fb.pos, fb.pos + fb.size, {
          class: `block-frame block-frame--${position}`,
          style: `--frame-color: ${color}; --frame-style: ${style};`,
        }),
      );
    });
  }

  return DecorationSet.create(doc, decorations);
}
