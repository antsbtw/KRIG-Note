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
} | undefined;

// ── 导航历史栈 ──

export interface NoteHistory {
  back: string[];
  forward: string[];
  current: string | null;
}

const history: NoteHistory = { back: [], forward: [], current: null };

export function setCurrentNote(noteId: string) {
  history.current = noteId;
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
          // TODO: scrollToBlock(parts[1]) after note loads
          navigateToNote(noteId);
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
