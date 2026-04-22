import { Plugin, PluginKey } from 'prosemirror-state';

/**
 * Link Click Plugin — 统一链接点击分发
 *
 * 点击 link mark 时根据 href 协议决定行为：
 * - krig://note/{noteId}  → 打开笔记（push 导航历史栈）
 * - krig://block/{noteId}/{blockId} → 打开笔记并滚动到 block
 * - https:// / http://    → 系统浏览器打开
 *
 * 导航历史栈：支持后退/前进
 */

const api = () => (window as any).viewAPI as {
  noteOpenInEditor: (id: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  mediaResolvePath: (src: string) => Promise<{ success: boolean; path: string }>;
  mediaOpenPath: (path: string) => void;
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

        if (href.startsWith('krig://note/')) {
          const noteId = href.replace('krig://note/', '');
          navigateToNote(noteId);
        } else if (href.startsWith('krig://block/')) {
          const parts = href.replace('krig://block/', '').split('/');
          const noteId = parts[0];
          const blockAnchor = parts.slice(1).join('/');
          if (blockAnchor) {
            if (noteId === history.current) {
              // 同文档内跳转 → 直接滚动
              scrollToBlockAnchor(view, blockAnchor);
            } else {
              // 跨文档跳转 → 存储锚点，等新笔记加载完后 flush
              pendingAnchor = blockAnchor;
              navigateToNote(noteId);
            }
          } else {
            navigateToNote(noteId);
          }
        } else if (href.startsWith('file://')) {
          // 本地文件路径 → 用系统默认应用打开
          const v = api();
          try {
            const filePath = decodeURIComponent(new URL(href).pathname);
            if (filePath && v?.mediaOpenPath) v.mediaOpenPath(filePath);
          } catch { /* ignore */ }
        } else if (href.startsWith('media://')) {
          // 文件链接 → 用系统默认应用打开
          const v = api();
          if (v?.mediaResolvePath) {
            v.mediaResolvePath(href).then(r => {
              if (r?.success && r.path) v.mediaOpenPath(r.path);
            }).catch(() => {});
          }
        } else {
          // Web 链接 → 系统浏览器
          const v = api();
          if (v?.openExternal) v.openExternal(href);
        }

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
