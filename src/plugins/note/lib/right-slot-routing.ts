/**
 * Right-slot routing — 5 协议链接路由(M2.1.8 F-6 抽出)
 *
 * Note 是链接协议的"主张者",这些 helper 由 note 拥有;canvas 等其他组件
 * 作为消费方 import 使用.
 *
 * 5 种协议:
 *   krig://note/{id}                    → right slot NoteView + loadNote
 *   krig://block/{id}/{anchor}           → 同上 + heading 锚点滚动(同文档原地滚动)
 *   https://...                          → right slot WebView + loadURL
 *   file://*.pdf/.epub/.djvu/.cbz        → right slot eBookView + bookshelfAdd
 *   file://其他 / media://               → OS 关联应用 fallback
 *
 * 路由两步走:
 *   1. 框架契约:await requestCompanion(workModeId) — 框架确保 right slot 是
 *      指定 view 并完成 view 创建
 *   2. 插件契约:noteOpenInRightSlot / webOpenInRightSlot / ebookBookshelfAdd
 *      派发数据;插件 handler 在主进程会等 webContents did-finish-load 后再发
 */

const api = () => (window as any).viewAPI as {
  noteOpenInEditor: (id: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  mediaResolvePath: (src: string) => Promise<{ success: boolean; path: string }>;
  mediaOpenPath: (path: string) => void;
  requestCompanion?: (workModeId: string) => Promise<void>;
  noteOpenInRightSlot?: (id: string) => Promise<void>;
  webOpenInRightSlot?: (url: string) => Promise<void>;
  ebookBookshelfAdd?: (filePath: string, fileType: 'pdf' | 'epub' | 'djvu' | 'cbz', storage?: 'managed' | 'link') => Promise<unknown>;
} | undefined;

// 对应 plugins/*/main/register.ts 里注册的 workModeId
// (架构债:这些应改名为 'note' / 'ebook' / 'web';见 memory project_workmode_id_demo_legacy)
const WORKMODE_NOTE = 'demo-a';
const WORKMODE_EBOOK = 'demo-b';
const WORKMODE_WEB = 'demo-c';

export async function openNoteInRightSlot(noteId: string, anchor: string | null = null): Promise<void> {
  const v = api();
  if (!v?.requestCompanion || !v.noteOpenInRightSlot) {
    console.warn('[right-slot-routing] missing requestCompanion or noteOpenInRightSlot');
    return;
  }
  await v.requestCompanion(WORKMODE_NOTE);
  await v.noteOpenInRightSlot(noteId);
  // anchor 滚动留 v1.x
  void anchor;
}

export async function openWebInRightSlot(url: string): Promise<void> {
  const v = api();
  if (!v?.requestCompanion || !v.webOpenInRightSlot) {
    console.warn('[right-slot-routing] missing requestCompanion or webOpenInRightSlot');
    return;
  }
  await v.requestCompanion(WORKMODE_WEB);
  await v.webOpenInRightSlot(url);
}

export async function openEbookInRightSlot(filePath: string, fileType: 'pdf' | 'epub' | 'djvu' | 'cbz'): Promise<void> {
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

export function getEbookFileType(path: string): 'pdf' | 'epub' | 'djvu' | 'cbz' | null {
  const idx = path.lastIndexOf('.');
  if (idx < 0) return null;
  const ext = path.slice(idx).toLowerCase();
  return EBOOK_EXT_MAP[ext] ?? null;
}

/**
 * 按 href 协议派发到 right slot(或 OS fallback).
 *
 * 这是 5 协议路由的统一入口 — link-click(NoteView 编辑态)和 LinkHitOverlay
 * (画板渲染态)都调它,保证规则单一来源.
 */
export function dispatchLinkHref(href: string): void {
  if (!href) return;

  if (href.startsWith('krig://note/')) {
    const noteId = href.replace('krig://note/', '');
    void openNoteInRightSlot(noteId);
    return;
  }

  if (href.startsWith('krig://block/')) {
    const parts = href.replace('krig://block/', '').split('/');
    const noteId = parts[0];
    const blockAnchor = parts.slice(1).join('/');
    void openNoteInRightSlot(noteId, blockAnchor || null);
    return;
  }

  if (href.startsWith('file://')) {
    const v = api();
    try {
      const filePath = decodeURIComponent(new URL(href).pathname);
      if (!filePath) return;
      const fileType = getEbookFileType(filePath);
      if (fileType) {
        void openEbookInRightSlot(filePath, fileType);
      } else if (v?.mediaOpenPath) {
        v.mediaOpenPath(filePath);
      }
    } catch { /* ignore */ }
    return;
  }

  if (href.startsWith('media://')) {
    // M2.1.8 不做 right slot media 预览(留 v1.x);走 OS 关联应用 fallback
    const v = api();
    if (v?.mediaResolvePath) {
      v.mediaResolvePath(href).then(r => {
        if (r?.success && r.path) v.mediaOpenPath(r.path);
      }).catch(() => {});
    }
    return;
  }

  // https / http / 其他 → right slot WebView
  void openWebInRightSlot(href);
}
