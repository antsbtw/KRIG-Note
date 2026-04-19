import type { EditorView } from 'prosemirror-view';
import { selectionToMarkdown } from './selection-to-markdown';
import type { SelectionMarkdownResult } from './selection-to-markdown';
import { blockSelectionKey } from '../plugins/block-selection';

/**
 * SelectionCache — 选区内容缓存
 *
 * 在用户选中内容时实时提取 Markdown + images 并缓存。
 * 后续操作（ContextMenu 问 AI、AddThought 等）直接读缓存，
 * 不受右键菜单折叠选区的影响。
 *
 * 使用方式：
 *   NoteEditor 创建 EditorView 后调用 startSelectionCache(view)
 *   组件销毁时调用返回的 cleanup 函数
 *   任何地方调用 getSelectionCache() 读取最新缓存
 */

export interface SelectionCacheData {
  markdown: string;
  images: string[];
  from: number;
  to: number;
  timestamp: number;
}

let currentCache: SelectionCacheData | null = null;

/** 获取当前缓存的选区内容 */
export function getSelectionCache(): SelectionCacheData | null {
  return currentCache;
}

/**
 * 在 dispatchTransaction 中调用，更新选区缓存。
 * 每次 ProseMirror state 变化时由 NoteEditor 调用。
 */
export function updateSelectionCache(view: EditorView): void {
  const state = view.state;

  // 优先检查 block-selection
  const blockSel = blockSelectionKey.getState(state);
  if (blockSel?.active && blockSel.selectedPositions.length > 0) {
    const sorted = [...blockSel.selectedPositions].sort((a, b) => a - b);
    const first = sorted[0];
    const lastPos = sorted[sorted.length - 1];
    const lastNode = state.doc.nodeAt(lastPos);
    const to = lastNode ? lastPos + lastNode.nodeSize : lastPos + 1;
    const md = state.doc.textBetween(first, to, '\n\n');
    currentCache = { markdown: md, images: [], from: first, to, timestamp: Date.now() };
    return;
  }

  // 普通选区：非空时更新缓存
  const { from, to } = state.selection;
  if (from !== to) {
    const result = selectionToMarkdown(view);
    currentCache = { ...result, from, to, timestamp: Date.now() };
  }
  // 选区为空时不清除缓存（保留上次选区的内容，供右键菜单使用）
}

/** 清除缓存 */
export function clearSelectionCache(): void {
  currentCache = null;
}
