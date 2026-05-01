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
  /** Right slot 路由(M2.1.6d):打开 right slot + 通知它装载内容 */
  requestCompanion?: (workModeId: string) => Promise<void>;
  sendToOtherSlot?: (msg: any) => void;
  /** M2.1.6d:绕过 sendToOtherSlot 协议表,主进程直接 push noteId 到 right slot */
  noteOpenInRightSlot?: (id: string) => Promise<void>;
  /** M2.1.6d:同上,在 right slot 打开 URL(WebView loadURL) */
  webOpenInRightSlot?: (url: string) => Promise<void>;
  /** Ebook 加书架并加载(主进程会广播 EBOOK_LOADED 给所有 view,right slot ebook view 会自动加载) */
  ebookBookshelfAdd?: (filePath: string, fileType: 'pdf' | 'epub' | 'djvu' | 'cbz', storage?: 'managed' | 'link') => Promise<unknown>;
} | undefined;

/**
 * Right slot 装载逻辑(M2.1.6d).
 *
 * KRIG 链接行为:点击 inline 链接不再"跳走"主视图,而是在 right slot 浮出对应内容.
 * 5 种协议路由(均为两步式:requestCompanion 打开对应 view + 通知装载内容):
 *   krig://note/{id}          → right slot note view + 加载该 note
 *   krig://block/{id}/{anchor} → 同上 + 滚动到 heading anchor(同文档则原地滚动)
 *   https://...               → right slot web view + loadURL
 *   file://{path}.pdf|.epub|.djvu|.cbz → right slot ebook view + bookshelfAdd 加书架并加载
 *   file://{path} 其他扩展名     → OS 关联应用 fallback
 *   media://{id}              → OS 关联应用(M2.1 不做 media right slot,留 v1.x)
 */

/**
 * Right slot 路由两步走(M2.1.6d):
 *   1. 框架契约:await requestCompanion(workModeId) — 框架确保 right slot 是
 *      指定 view 并完成 view 创建(promise resolve 时 view 已 attach,但
 *      renderer 可能还在加载).
 *   2. 插件契约:noteOpenInRightSlot / webOpenInRightSlot / ebookBookshelfAdd
 *      派发数据;插件 handler 在主进程会等 webContents did-finish-load 后再发.
 *
 * 之所以分两步:框架只懂"打开哪种 view",插件懂"加载什么内容".这是分层
 * 注册原则的直接体现 — 不让插件主进程 reach 进框架内部去 ensure slot.
 */

// 对应 plugins/*/main/register.ts 里注册的 workModeId
const WORKMODE_NOTE = 'demo-a';
const WORKMODE_EBOOK = 'demo-b';
const WORKMODE_WEB = 'demo-c';

async function openNoteInRightSlot(noteId: string, anchor: string | null = null): Promise<void> {
  const v = api();
  if (!v?.requestCompanion || !v.noteOpenInRightSlot) {
    console.warn('[link-click] missing requestCompanion or noteOpenInRightSlot');
    return;
  }
  await v.requestCompanion(WORKMODE_NOTE);
  await v.noteOpenInRightSlot(noteId);
  // anchor 滚动留 v1.x
  void anchor;
}

async function openWebInRightSlot(url: string): Promise<void> {
  const v = api();
  if (!v?.requestCompanion || !v.webOpenInRightSlot) {
    console.warn('[link-click] missing requestCompanion or webOpenInRightSlot');
    return;
  }
  await v.requestCompanion(WORKMODE_WEB);
  await v.webOpenInRightSlot(url);
}

async function openEbookInRightSlot(filePath: string, fileType: 'pdf' | 'epub' | 'djvu' | 'cbz'): Promise<void> {
  const v = api();
  if (!v?.requestCompanion || !v.ebookBookshelfAdd) return;
  await v.requestCompanion(WORKMODE_EBOOK);
  // ebook view 加载由 EBOOK_LOADED 广播驱动 — 把书加进书架并加载即可
  await v.ebookBookshelfAdd(filePath, fileType, 'link').catch(() => { /* ignore */ });
}

const EBOOK_EXT_MAP: Record<string, 'pdf' | 'epub' | 'djvu' | 'cbz'> = {
  '.pdf': 'pdf',
  '.epub': 'epub',
  '.djvu': 'djvu',
  '.cbz': 'cbz',
};

function getEbookFileType(path: string): 'pdf' | 'epub' | 'djvu' | 'cbz' | null {
  const idx = path.lastIndexOf('.');
  if (idx < 0) return null;
  const ext = path.slice(idx).toLowerCase();
  return EBOOK_EXT_MAP[ext] ?? null;
}

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

        // 5 种协议 → right slot 路由(M2.1.6d).
        // 同文档内 anchor 跳转例外:还是直接滚动(无意义打开 right slot)
        if (href.startsWith('krig://note/')) {
          const noteId = href.replace('krig://note/', '');
          void openNoteInRightSlot(noteId);
        } else if (href.startsWith('krig://block/')) {
          const parts = href.replace('krig://block/', '').split('/');
          const noteId = parts[0];
          const blockAnchor = parts.slice(1).join('/');
          if (blockAnchor && noteId === history.current) {
            // 同文档内跳转 → 直接滚动
            scrollToBlockAnchor(view, blockAnchor);
          } else {
            void openNoteInRightSlot(noteId, blockAnchor || null);
          }
        } else if (href.startsWith('file://')) {
          // M2.1.6d:本地文件 → ebook 格式打开 right slot ebook view;否则 OS 关联应用
          const v = api();
          try {
            const filePath = decodeURIComponent(new URL(href).pathname);
            if (!filePath) return true;
            const fileType = getEbookFileType(filePath);
            if (fileType) {
              void openEbookInRightSlot(filePath, fileType);
            } else if (v?.mediaOpenPath) {
              v.mediaOpenPath(filePath);
            }
          } catch { /* ignore */ }
        } else if (href.startsWith('media://')) {
          // M2.1.6d 暂不做 right slot media 预览(留 v1.x);走 OS 关联应用 fallback
          const v = api();
          if (v?.mediaResolvePath) {
            v.mediaResolvePath(href).then(r => {
              if (r?.success && r.path) v.mediaOpenPath(r.path);
            }).catch(() => {});
          }
        } else {
          // Web 链接 → right slot web view
          void openWebInRightSlot(href);
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
