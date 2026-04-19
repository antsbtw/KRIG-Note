/**
 * frame-commands — Block 框定操作命令
 *
 * 提供：添加框定 / 修改颜色 / 修改样式 / 删除框定
 */

import type { EditorView } from 'prosemirror-view';
import { blockSelectionKey } from '../plugins/block-selection';

function generateGroupId(): string {
  return `frame-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 给指定位置的 block 添加框定
 *
 * @param view EditorView
 * @param pos block 节点位置
 * @param color 边框颜色
 * @param style 边框样式 'solid' | 'double'
 */
export function addBlockFrame(
  view: EditorView,
  pos: number,
  color: string,
  style: 'solid' | 'double' = 'solid',
): void {
  const node = view.state.doc.nodeAt(pos);
  if (!node) return;

  const tr = view.state.tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    frameColor: color,
    frameStyle: style,
    frameGroupId: null,
  });
  view.dispatch(tr);
}

/**
 * 给多个连续 block 添加分组框定
 *
 * @param view EditorView
 * @param positions block 节点位置数组
 * @param color 边框颜色
 * @param style 边框样式
 */
export function addBlockFrameGroup(
  view: EditorView,
  positions: number[],
  color: string,
  style: 'solid' | 'double' = 'solid',
): void {
  if (positions.length === 0) return;

  const groupId = positions.length > 1 ? generateGroupId() : null;
  let tr = view.state.tr;

  for (const pos of positions) {
    const node = tr.doc.nodeAt(pos);
    if (!node) continue;
    tr = tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      frameColor: color,
      frameStyle: style,
      frameGroupId: groupId,
    });
  }

  view.dispatch(tr);
}

/**
 * 修改框定颜色
 */
export function updateBlockFrameColor(view: EditorView, pos: number, color: string): void {
  const node = view.state.doc.nodeAt(pos);
  if (!node || !node.attrs.frameColor) return;

  // 如果有 groupId，更新同组所有 block
  const groupId = node.attrs.frameGroupId;
  if (groupId) {
    let tr = view.state.tr;
    view.state.doc.forEach((child, offset) => {
      if (child.attrs.frameGroupId === groupId) {
        tr = tr.setNodeMarkup(offset, undefined, { ...child.attrs, frameColor: color });
      }
    });
    view.dispatch(tr);
  } else {
    view.dispatch(
      view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, frameColor: color }),
    );
  }
}

/**
 * 修改框定样式
 */
export function updateBlockFrameStyle(view: EditorView, pos: number, style: 'solid' | 'double'): void {
  const node = view.state.doc.nodeAt(pos);
  if (!node || !node.attrs.frameColor) return;

  const groupId = node.attrs.frameGroupId;
  if (groupId) {
    let tr = view.state.tr;
    view.state.doc.forEach((child, offset) => {
      if (child.attrs.frameGroupId === groupId) {
        tr = tr.setNodeMarkup(offset, undefined, { ...child.attrs, frameStyle: style });
      }
    });
    view.dispatch(tr);
  } else {
    view.dispatch(
      view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, frameStyle: style }),
    );
  }
}

/**
 * 删除框定
 */
export function removeBlockFrame(view: EditorView, pos: number): void {
  const node = view.state.doc.nodeAt(pos);
  if (!node) return;

  const groupId = node.attrs.frameGroupId;
  if (groupId) {
    let tr = view.state.tr;
    view.state.doc.forEach((child, offset) => {
      if (child.attrs.frameGroupId === groupId) {
        tr = tr.setNodeMarkup(offset, undefined, {
          ...child.attrs,
          frameColor: null,
          frameStyle: null,
          frameGroupId: null,
        });
      }
    });
    view.dispatch(tr);
  } else {
    view.dispatch(
      view.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        frameColor: null,
        frameStyle: null,
        frameGroupId: null,
      }),
    );
  }
}

/**
 * 获取当前选区覆盖的 top-level block 位置列表
 *
 * 优先读取 block-selection 插件的多选状态，
 * 回退到 ProseMirror 文本选区的 from/to 范围。
 */
export function getSelectedBlockPositions(view: EditorView): number[] {
  // 优先使用 block-selection 插件的多选状态
  const blockSelState = blockSelectionKey.getState(view.state);
  if (blockSelState?.active && blockSelState.selectedPositions.length > 0) {
    return [...blockSelState.selectedPositions];
  }

  // 回退到文本选区范围
  const { from, to } = view.state.selection;
  const positions: number[] = [];

  view.state.doc.forEach((node, offset) => {
    if (!node.isBlock) return;
    const nodeEnd = offset + node.nodeSize;
    // block 与选区有交集
    if (offset < to && nodeEnd > from) {
      positions.push(offset);
    }
  });

  return positions;
}
