/**
 * editor-commands — 编辑器通用命令
 *
 * 所有编辑操作的唯一实现。ContextMenu / FloatingToolbar / HandleMenu /
 * SlashMenu / 快捷键 / block-selection 都只是入口，调用这里的函数。
 *
 * 原则：
 *   - 同一操作只有一个函数
 *   - 函数接收 EditorView（或 EditorState + dispatch），不接收 UI 状态
 *   - 函数内部处理所有边界条件（空选区、title 保护、column 级联等）
 */

import type { EditorView } from 'prosemirror-view';
import type { MarkType } from 'prosemirror-model';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import { toggleMark } from 'prosemirror-commands';
import { blockSelectionKey } from '../plugins/block-selection';
import { deleteColumnAt } from '../plugins/container-keyboard';

// ── Clipboard ──

/**
 * 剪切：复制选区到剪贴板 + 删除选区内容。
 *
 * 触发方式：Cmd+X / ContextMenu Cut
 * 剪贴板写入由 smart-paste-plugin 的 handleDOMEvents.cut 处理（attachInternalClipboard），
 * 这里只负责删除。如果从非 DOM 事件入口调用（如 ContextMenu），需要先触发 copy 再调 deleteSelection。
 */
export function deleteSelection(view: EditorView): boolean {
  const blockSel = blockSelectionKey.getState(view.state);
  if (blockSel?.active && blockSel.selectedPositions.length > 0) {
    deleteBlocks(view, blockSel.selectedPositions);
    return true;
  }
  if (!view.state.selection.empty) {
    view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
    return true;
  }
  return false;
}

// ── Block Deletion ──

/**
 * 删除指定位置的 block 节点。
 *
 * 处理 column 级联：如果删除的是 column，走 deleteColumnAt 处理
 * "只剩 1 列时解散 column-list" 的逻辑。
 *
 * 触发方式：ContextMenu Delete / HandleMenu Delete / block-selection Delete/Backspace
 */
export function deleteBlockAt(view: EditorView, pos: number): boolean {
  const node = view.state.doc.nodeAt(pos);
  if (!node) return false;

  // title 保护
  if (node.type.name === 'textBlock' && node.attrs.isTitle) return false;

  // column 级联
  if (node.type.name === 'column') {
    const $pos = view.state.doc.resolve(pos);
    if ($pos.parent.type.name === 'columnList') {
      deleteColumnAt(view, $pos.before($pos.depth), pos);
      return true;
    }
  }

  view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize));
  return true;
}

/**
 * 批量删除多个 block（从后往前删避免位置漂移）。
 *
 * 触发方式：block-selection Delete/Backspace、cut
 */
export function deleteBlocks(view: EditorView, positions: number[]): void {
  const sorted = [...positions].sort((a, b) => b - a);
  let tr = view.state.tr;
  for (const pos of sorted) {
    const node = tr.doc.nodeAt(pos);
    if (node) {
      tr.delete(pos, pos + node.nodeSize);
    }
  }
  if (tr.doc.childCount === 0) {
    tr.insert(0, view.state.schema.nodes.textBlock.create());
  }
  tr.setMeta(blockSelectionKey, { active: false, selectedPositions: [], anchorPos: null });
  view.dispatch(tr);
  view.dom.classList.remove('block-selection-active');
}

/**
 * 删除光标所在的顶层 block。
 *
 * 触发方式：ContextMenu Delete
 */
export function deleteCurrentBlock(view: EditorView): boolean {
  const { $from } = view.state.selection;
  if ($from.depth < 1) return false;
  const pos = $from.before(1);
  return deleteBlockAt(view, pos);
}

// ── Mark Toggle ──

/**
 * 切换 mark（bold/italic/underline/strike/code）。
 *
 * 触发方式：Cmd+B/I/U/Shift+S/E / FloatingToolbar
 */
export function toggleMarkCommand(view: EditorView, markType: MarkType): boolean {
  return toggleMark(markType)(view.state, view.dispatch);
}

// ── Link ──

/**
 * 给选区添加链接 mark。
 *
 * 触发方式：FloatingToolbar Link 面板
 */
export function applyLink(view: EditorView, href: string): boolean {
  const linkType = view.state.schema.marks.link;
  if (!linkType || !href) return false;
  const { from, to } = view.state.selection;
  if (from === to) return false;
  view.dispatch(view.state.tr.addMark(from, to, linkType.create({ href })));
  return true;
}

/**
 * 移除选区的链接 mark。
 *
 * 触发方式：FloatingToolbar Link 面板
 */
export function removeLink(view: EditorView): boolean {
  const linkType = view.state.schema.marks.link;
  if (!linkType) return false;
  const { from, to } = view.state.selection;

  if (from !== to) {
    // 有选区：移除选区范围内的 link mark
    view.dispatch(view.state.tr.removeMark(from, to, linkType));
    return true;
  }

  // 光标模式：找到光标所在 link mark 的完整范围
  const $pos = view.state.doc.resolve(from);
  const parent = $pos.parent;
  const parentStart = $pos.start();
  let linkFrom = from;
  let linkTo = from;

  parent.forEach((node, offset) => {
    const nodeStart = parentStart + offset;
    const nodeEnd = nodeStart + node.nodeSize;
    if (nodeStart <= from && from <= nodeEnd && linkType.isInSet(node.marks)) {
      linkFrom = nodeStart;
      linkTo = nodeEnd;
    }
  });

  if (linkFrom < linkTo) {
    view.dispatch(view.state.tr.removeMark(linkFrom, linkTo, linkType));
    return true;
  }
  return false;
}

// ── Color ──

/**
 * 给指定范围设置文字颜色。color 为空字符串时移除颜色。
 *
 * 触发方式：FloatingToolbar ColorPicker / HandleMenu Color
 */
export function applyTextColor(view: EditorView, from: number, to: number, color: string): boolean {
  const markType = view.state.schema.marks.textStyle;
  if (!markType || from >= to) return false;
  const tr = view.state.tr;
  if (!color) {
    tr.removeMark(from, to, markType);
  } else {
    tr.addMark(from, to, markType.create({ color }));
  }
  view.dispatch(tr);
  return true;
}

/**
 * 给指定范围设置背景高亮色。color 为空字符串时移除。
 *
 * 触发方式：FloatingToolbar ColorPicker / HandleMenu Color
 */
export function applyHighlight(view: EditorView, from: number, to: number, color: string): boolean {
  const markType = view.state.schema.marks.highlight;
  if (!markType || from >= to) return false;
  const tr = view.state.tr;
  if (!color) {
    tr.removeMark(from, to, markType);
  } else {
    tr.addMark(from, to, markType.create({ color }));
  }
  view.dispatch(tr);
  return true;
}

// ── Text Indent ──

/**
 * 切换指定位置 block 的首行缩进。
 *
 * 触发方式：Shift+Cmd+I / HandleMenu Format
 */
export function toggleTextIndent(view: EditorView, pos: number): boolean {
  const node = view.state.doc.nodeAt(pos);
  if (!node) return false;
  const current = node.attrs.textIndent ?? false;
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, textIndent: !current }));
  return true;
}

// ── Text Align ──

/**
 * 设置指定位置 block 的对齐方式。
 *
 * 触发方式：HandleMenu Format
 */
export function setTextAlign(view: EditorView, pos: number, align: string): boolean {
  const node = view.state.doc.nodeAt(pos);
  if (!node) return false;
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, align }));
  return true;
}

// ── Inline Math ──

/**
 * 将选区文字转为行内数学公式。
 *
 * 触发方式：FloatingToolbar ∑ 按钮 / SlashMenu
 */
export function insertInlineMath(view: EditorView): boolean {
  const mathType = view.state.schema.nodes.mathInline;
  if (!mathType) return false;
  const { from, to } = view.state.selection;
  const selectedText = view.state.doc.textBetween(from, to, '');
  const mathNode = mathType.create({ latex: selectedText });
  view.dispatch(view.state.tr.replaceWith(from, to, mathNode));
  return true;
}
