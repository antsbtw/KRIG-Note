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

/** 启动选区缓存追踪，返回 cleanup 函数 */
export function startSelectionCache(view: EditorView): () => void {
  let prevFrom = -1;
  let prevTo = -1;

  const update = () => {
    // 优先检查 block-selection
    const state = view.state;
    const blockSel = blockSelectionKey.getState(state);
    if (blockSel?.active && blockSel.selectedPositions.length > 0) {
      const sorted = [...blockSel.selectedPositions].sort((a, b) => a - b);
      const first = sorted[0];
      const lastPos = sorted[sorted.length - 1];
      const lastNode = state.doc.nodeAt(lastPos);
      const to = lastNode ? lastPos + lastNode.nodeSize : lastPos + 1;
      if (first !== prevFrom || to !== prevTo) {
        prevFrom = first;
        prevTo = to;
        // block-selection 用 textBetween（selectionToMarkdown 依赖 PM selection）
        const md = state.doc.textBetween(first, to, '\n\n');
        currentCache = { markdown: md, images: [], from: first, to, timestamp: Date.now() };
      }
      return;
    }

    // 普通选区
    const { from, to } = state.selection;
    if (from !== to && (from !== prevFrom || to !== prevTo)) {
      prevFrom = from;
      prevTo = to;
      const result = selectionToMarkdown(view);
      currentCache = { ...result, from, to, timestamp: Date.now() };
    }
  };

  // 用 rAF 轮询（与 FloatingToolbar 一致，可靠追踪所有选区变化）
  let rafId: number;
  const poll = () => {
    update();
    rafId = requestAnimationFrame(poll);
  };
  rafId = requestAnimationFrame(poll);

  return () => {
    cancelAnimationFrame(rafId);
    currentCache = null;
  };
}
