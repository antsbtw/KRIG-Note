import { Plugin, PluginKey } from 'prosemirror-state';
import {
  dispatchLinkHref,
  openNoteInRightSlot,
} from '../lib/right-slot-routing';

/**
 * Link Click Plugin — NoteView 编辑态链接点击分发
 *
 * 5 协议路由统一走 ../lib/right-slot-routing.ts(canvas 也复用同一模块).
 *
 * 本插件只额外做一件事:**同文档内 krig://block 跳转**直接 PM 滚动,
 * 不打开 right slot(用户感知:点目录像滚动到那里,不是开新窗口).
 *
 * 导航历史栈(后退/前进):走 noteOpenInEditor 主视图导航,与 right slot 无关.
 */

const api = () => (window as any).viewAPI as {
  noteOpenInEditor: (id: string) => Promise<void>;
} | undefined;

// ── 导航历史栈 ──

export interface NoteHistory {
  back: string[];
  forward: string[];
  current: string | null;
}

const history: NoteHistory = { back: [], forward: [], current: null };

export function setCurrentNote(noteId: string | null) {
  history.current = noteId;
}

export function getCurrentNoteId(): string | null {
  return history.current;
}

export function canGoBack(): boolean { return history.back.length > 0; }
export function canGoForward(): boolean { return history.forward.length > 0; }

export function goBack(): string | null {
  if (history.back.length === 0) return null;
  if (history.current) history.forward.push(history.current);
  history.current = history.back.pop()!;
  const v = api();
  if (v && history.current) v.noteOpenInEditor(history.current);
  return history.current;
}

export function goForward(): string | null {
  if (history.forward.length === 0) return null;
  if (history.current) history.back.push(history.current);
  history.current = history.forward.pop()!;
  const v = api();
  if (v && history.current) v.noteOpenInEditor(history.current);
  return history.current;
}

function navigateToNote(noteId: string) {
  if (history.current) history.back.push(history.current);
  history.forward = []; // 新导航清空前进栈
  history.current = noteId;
  const v = api();
  if (v) v.noteOpenInEditor(noteId);
}

// ── 待执行的 block 锚点滚动 ──

let pendingAnchor: string | null = null;

/**
 * 外部调用：笔记加载完成后检查是否有待滚动的锚点。
 * NoteEditor 在 setDoc 后调用此函数。
 */
export function flushPendingAnchor(view: import('prosemirror-view').EditorView): void {
  if (!pendingAnchor) return;
  const anchor = pendingAnchor;
  pendingAnchor = null;
  // 延迟一帧，确保 DOM 渲染完成
  requestAnimationFrame(() => scrollToBlockAnchor(view, anchor));
}

/**
 * 滚动到目标 block
 *
 * anchor 格式：
 * - 纯文本 → 按标题文本匹配（heading）
 * - "3:前缀文本" → 按顺序索引 + 文本前缀匹配（普通 block）
 */
function scrollToBlockAnchor(view: import('prosemirror-view').EditorView, anchor: string) {
  const doc = view.state.doc;
  let targetPos: number | null = null;

  // 解析 "idx:text" 格式
  const idxMatch = anchor.match(/^(\d+):(.*)$/);
  if (idxMatch) {
    const targetIdx = parseInt(idxMatch[1], 10);
    const textPrefix = decodeURIComponent(idxMatch[2]);
    let idx = 0;
    doc.forEach((node, offset) => {
      if (targetPos !== null) return;
      if (idx === targetIdx) {
        // 索引匹配，再验证文本前缀
        const text = node.textContent.trim();
        if (!textPrefix || text.startsWith(textPrefix)) {
          targetPos = offset;
        }
      }
      idx++;
    });
    // 索引匹配失败 → 退而按文本前缀搜索全文
    if (targetPos === null && textPrefix) {
      doc.forEach((node, offset) => {
        if (targetPos !== null) return;
        if (node.textContent.trim().startsWith(textPrefix)) {
          targetPos = offset;
        }
      });
    }
  } else {
    // 纯文本 → 按标题文本匹配
    const decoded = decodeURIComponent(anchor);
    doc.forEach((node, offset) => {
      if (targetPos !== null) return;
      if (node.type.name === 'textBlock' && node.attrs.level) {
        const text = node.textContent.trim();
        if (text === decoded || text.startsWith(decoded)) {
          targetPos = offset;
        }
      }
    });
    // 标题未匹配 → 退而搜索全文
    if (targetPos === null) {
      doc.forEach((node, offset) => {
        if (targetPos !== null) return;
        if (node.textContent.trim().startsWith(decoded)) {
          targetPos = offset;
        }
      });
    }
  }

  if (targetPos !== null) {
    const dom = view.nodeDOM(targetPos);
    if (dom instanceof HTMLElement) {
      dom.scrollIntoView({ behavior: 'smooth', block: 'start' });
      dom.classList.add('block-link-highlight');
      setTimeout(() => dom.classList.remove('block-link-highlight'), 2000);
    }
  }
}

// ── Plugin ──

export const linkClickKey = new PluginKey('linkClick');

export function linkClickPlugin(): Plugin {
  return new Plugin({
    key: linkClickKey,

    props: {
      handleClick(view, pos, event) {
        // 只处理左键点击
        if (event.button !== 0) return false;

        // 找到点击位置的 link mark
        const $pos = view.state.doc.resolve(pos);
        const marks = $pos.marks();
        const linkMark = marks.find(m => m.type.name === 'link');
        if (!linkMark) return false;

        const href = linkMark.attrs.href as string;
        if (!href) return false;

        event.preventDefault();
        event.stopPropagation();

        // 同文档内 krig://block 跳转例外:直接 PM 滚动,不开 right slot
        if (href.startsWith('krig://block/')) {
          const parts = href.replace('krig://block/', '').split('/');
          const noteId = parts[0];
          const blockAnchor = parts.slice(1).join('/');
          if (blockAnchor && noteId === history.current) {
            scrollToBlockAnchor(view, blockAnchor);
            return true;
          }
          // 跨文档 → 走通用路由(打开 right slot NoteView + 滚动 anchor)
          void openNoteInRightSlot(noteId, blockAnchor || null);
          return true;
        }

        // 其余 4 种协议 → 共享路由(canvas 也用此)
        dispatchLinkHref(href);
        return true;
      },

      handleKeyDown(view, event) {
        // Cmd+[ 后退, Cmd+] 前进
        if (event.metaKey || event.ctrlKey) {
          if (event.key === '[') {
            if (canGoBack()) { goBack(); return true; }
          }
          if (event.key === ']') {
            if (canGoForward()) { goForward(); return true; }
          }
        }
        return false;
      },
    },
  });
}
