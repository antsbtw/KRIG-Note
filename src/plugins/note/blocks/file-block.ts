import type { BlockDef, NodeViewFactory } from '../types';
import type { Node as PMNode } from 'prosemirror-model';
import { createPlaceholder } from './render-block-base';

/**
 * fileBlock — 通用附件（RenderBlock）
 *
 * 承载任意 MIME 的文件字节，字节已持久化到 media store，
 * src 是 `media://files/...` 协议 URL（由 media-store 的 custom
 * protocol handler 解析为本地磁盘文件）。
 *
 * 典型场景：
 *   - AI 生成的 HTML/CSV/PDF 等（Claude Artifact Download file、
 *     ChatGPT Canvas / Code Interpreter 输出文件、Gemini Deep
 *     Research PDF）
 *   - 用户拖入 KRIG 的文件
 *
 * 区别于 externalRef：fileBlock 的字节在 KRIG 内部，附件"跟着 note
 * 走"；externalRef 只存路径/URL，文件删/移动/网络不通就断链。
 *
 * NodeView 是只读卡片：icon + 文件名 + 大小 + [打开] [在 Finder 显示]。
 * 用户不能在 note 里编辑附件内容 — 如需编辑源文件，在系统里打开。
 */

function iconForMime(mime: string): string {
  if (!mime) return '📎';
  if (mime.startsWith('image/')) return '🖼';
  if (mime.startsWith('video/')) return '🎞';
  if (mime.startsWith('audio/')) return '🔊';
  if (mime === 'application/pdf') return '📕';
  if (mime === 'application/zip' || mime === 'application/x-tar' || mime === 'application/x-7z-compressed') return '🗜';
  if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml') return '📄';
  if (mime.includes('spreadsheet') || mime === 'text/csv') return '📊';
  if (mime.includes('wordprocessing') || mime === 'application/msword') return '📝';
  if (mime.includes('presentation')) return '📽';
  return '📎';
}

/**
 * Resolve a src (possibly `media://...`) to a local disk path via the
 * MEDIA_RESOLVE_PATH IPC. Returns null for non-media URLs or on
 * failure. `media://` is a renderer-only protocol and the OS can't
 * open it directly, so anything that wants shell.openPath /
 * showItemInFolder needs this resolution first.
 */
async function resolveToLocalPath(src: string, api: any): Promise<string | null> {
  if (!src) return null;
  if (src.startsWith('media://')) {
    try {
      const r = await api?.mediaResolvePath?.(src);
      return r?.success ? r.path : null;
    } catch { return null; }
  }
  if (src.startsWith('file://')) {
    try { return decodeURIComponent(new URL(src).pathname); } catch { return null; }
  }
  // Plain absolute path (rare for fileBlock.src, but tolerate it)
  if (src.startsWith('/')) return src;
  return null;
}

/**
 * Open a src with the right mechanism: media:// and file:// paths go
 * through shell.openPath (which respects the OS default handler),
 * http(s) URLs go through shell.openExternal (which opens in browser).
 */
async function openMediaOrUrl(src: string, api: any): Promise<void> {
  if (src.startsWith('media://') || src.startsWith('file://') || src.startsWith('/')) {
    const p = await resolveToLocalPath(src, api);
    if (p) api?.mediaOpenPath?.(p);
    return;
  }
  api?.openExternal?.(src);
}

function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/**
 * Resolve a `media://...` URL to a local filesystem path, for use with
 * shell.openPath / shell.showItemInFolder. The media protocol maps
 * `media://{subdir}/{filename}` to `{userData}/krig-data/media/{subdir}/{filename}`.
 * We don't have that path in the renderer, so we call openExternal with
 * the media:// URL directly — Electron won't handle `media://` for
 * "open with default program" though, so we prefer a dedicated
 * showItemInFolder path resolved on the main side. For v1 we fall back
 * to openExternal for the "Open" action, which does handle our media://
 * protocol because the registered handler streams the file with the
 * right MIME; the browser opens/renders it in a new window.
 */

const fileBlockNodeView: NodeViewFactory = (initialNode, view, getPos) => {
  let node = initialNode;

  // Follow KRIG render-block convention so global block-handle plugin
  // and hover styles work automatically (matches image/video/tweet).
  const dom = document.createElement('div');
  dom.classList.add('render-block', 'render-block--fileBlock');
  dom.dataset.atomType = 'fileBlock';

  dom.addEventListener('mouseenter', () => dom.classList.add('render-block--hovered'));
  dom.addEventListener('mouseleave', () => dom.classList.remove('render-block--hovered'));

  const api = (window as any).viewAPI;

  /** Update the underlying PM node's attributes. */
  const updateAttrs = (attrs: Record<string, unknown>) => {
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos == null) return;
    let tr = view.state.tr;
    for (const [key, value] of Object.entries(attrs)) {
      tr = tr.setNodeAttribute(pos, key, value);
    }
    view.dispatch(tr);
  };

  /** Push a picked File through the media store and fill block attrs. */
  const ingestFile = async (dataUrl: string, file?: File) => {
    if (!api?.mediaPutBase64) return;
    const mime = (file?.type || dataUrl.match(/^data:([^;]+);/)?.[1] || 'application/octet-stream');
    // Pass the original filename so the store picks the correct
    // extension — critical for macOS Finder handlers (pdf/docx/...).
    const r = await api.mediaPutBase64(dataUrl, mime, file?.name);
    if (r?.success && r.mediaUrl) {
      updateAttrs({
        src: r.mediaUrl,
        mediaId: r.mediaId || '',
        filename: file?.name || (node.attrs.filename as string) || 'file',
        mimeType: mime,
        size: file?.size ?? null,
        source: 'user-uploaded',
      });
    }
  };

  /** Render "filled" card state (have src) into the dom. */
  const renderCard = (n: PMNode) => {
    dom.innerHTML = '';
    const content = document.createElement('div');
    content.classList.add('render-block__content', 'file-block');
    dom.appendChild(content);
    const inner = document.createElement('div');
    inner.classList.add('file-block__inner');

    const iconEl = document.createElement('div');
    iconEl.classList.add('file-block__icon');
    iconEl.textContent = iconForMime((n.attrs.mimeType as string) || '');
    inner.appendChild(iconEl);

    const meta = document.createElement('div');
    meta.classList.add('file-block__meta');
    inner.appendChild(meta);

    const nameEl = document.createElement('div');
    nameEl.classList.add('file-block__name');
    nameEl.textContent = (n.attrs.filename as string) || '(未命名)';
    meta.appendChild(nameEl);

    const subEl = document.createElement('div');
    subEl.classList.add('file-block__sub');
    const bits: string[] = [];
    if (n.attrs.mimeType) bits.push(n.attrs.mimeType as string);
    const s = formatSize((n.attrs.size as number | undefined) ?? undefined);
    if (s) bits.push(s);
    subEl.textContent = bits.join(' · ');
    meta.appendChild(subEl);

    const actions = document.createElement('div');
    actions.classList.add('file-block__actions');

    const openBtn = document.createElement('button');
    openBtn.classList.add('file-block__btn');
    openBtn.textContent = '打开';
    openBtn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const src = (node.attrs.src as string) || '';
      if (!src) return;
      await openMediaOrUrl(src, api);
    });
    actions.appendChild(openBtn);

    const revealBtn = document.createElement('button');
    revealBtn.classList.add('file-block__btn');
    revealBtn.textContent = '在 Finder 显示';
    revealBtn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const src = (node.attrs.src as string) || '';
      if (!src) return;
      const p = await resolveToLocalPath(src, api);
      if (p) api?.showItemInFolder?.(p);
    });
    actions.appendChild(revealBtn);

    inner.appendChild(actions);
    content.appendChild(inner);
  };

  /** Render placeholder state (no src) — upload button + URL embed. */
  const renderPlaceholder = () => {
    dom.innerHTML = '';
    const content = document.createElement('div');
    content.classList.add('render-block__content', 'file-block');
    dom.appendChild(content);
    const placeholder = createPlaceholder({
      icon: '📎',
      uploadLabel: 'Choose file',
      uploadAccept: '*/*',
      embedLabel: 'media:// URL',
      embedPlaceholder: 'media://files/...',
      onUpload: (dataUrl, file) => { void ingestFile(dataUrl, file); },
      onEmbed: (url) => {
        updateAttrs({ src: url, filename: (node.attrs.filename as string) || 'file' });
      },
    });
    content.appendChild(placeholder);
  };

  const paint = (n: PMNode) => {
    if (n.attrs.src) renderCard(n);
    else renderPlaceholder();
  };

  paint(node);

  return {
    dom,
    update(updated) {
      if (updated.type.name !== 'fileBlock') return false;
      const hadSrc = !!node.attrs.src;
      const hasSrc = !!updated.attrs.src;
      node = updated;
      // Switch between placeholder and card when src toggles
      if (hadSrc !== hasSrc) {
        paint(node);
      } else if (hasSrc) {
        // Same card, just refresh attrs (filename/size/mime may have changed)
        renderCard(node);
      }
      return true;
    },
  };
};

export const fileBlockBlock: BlockDef = {
  name: 'fileBlock',
  group: 'block',
  nodeSpec: {
    group: 'block',
    atom: true,
    draggable: true,
    selectable: true,
    attrs: {
      atomId:    { default: null },
      mediaId:   { default: '' },
      src:       { default: '' },
      filename:  { default: '' },
      mimeType:  { default: '' },
      size:      { default: null },
      source:    { default: null },
    },
    parseDOM: [{
      tag: 'div.file-block',
      getAttrs(dom: HTMLElement) {
        return {
          mediaId:  dom.getAttribute('data-media-id') || '',
          src:      dom.getAttribute('data-src') || '',
          filename: dom.getAttribute('data-filename') || '',
          mimeType: dom.getAttribute('data-mime') || '',
          size:     dom.getAttribute('data-size') ? Number(dom.getAttribute('data-size')) : null,
          source:   dom.getAttribute('data-source') || null,
        };
      },
    }],
    toDOM(node: PMNode) {
      return ['div', {
        class: 'file-block',
        'data-media-id': node.attrs.mediaId || '',
        'data-src':      node.attrs.src || '',
        'data-filename': node.attrs.filename || '',
        'data-mime':     node.attrs.mimeType || '',
        'data-size':     node.attrs.size != null ? String(node.attrs.size) : '',
        'data-source':   node.attrs.source || '',
      }];
    },
  },
  nodeView: fileBlockNodeView,
  capabilities: { canDelete: true, canDrag: true },
  slashMenu: { label: 'File attachment', icon: '📎', group: 'media', keywords: ['file', 'attachment', 'pdf', 'attach', '附件'], order: 4 },
};
