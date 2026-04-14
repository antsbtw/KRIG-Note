import type { BlockDef, NodeViewFactory } from '../types';
import type { Node as PMNode } from 'prosemirror-model';

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

const fileBlockNodeView: NodeViewFactory = (node, _view, _getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('file-block');
  dom.setAttribute('contenteditable', 'false');
  dom.dataset.atomType = 'fileBlock';

  const inner = document.createElement('div');
  inner.classList.add('file-block__inner');
  dom.appendChild(inner);

  const iconEl = document.createElement('div');
  iconEl.classList.add('file-block__icon');
  inner.appendChild(iconEl);

  const meta = document.createElement('div');
  meta.classList.add('file-block__meta');
  inner.appendChild(meta);

  const nameEl = document.createElement('div');
  nameEl.classList.add('file-block__name');
  meta.appendChild(nameEl);

  const subEl = document.createElement('div');
  subEl.classList.add('file-block__sub');
  meta.appendChild(subEl);

  const actions = document.createElement('div');
  actions.classList.add('file-block__actions');
  inner.appendChild(actions);

  const openBtn = document.createElement('button');
  openBtn.classList.add('file-block__btn');
  openBtn.textContent = '打开';
  actions.appendChild(openBtn);

  const revealBtn = document.createElement('button');
  revealBtn.classList.add('file-block__btn');
  revealBtn.textContent = '在 Finder 显示';
  actions.appendChild(revealBtn);

  function render(n: PMNode) {
    const src = (n.attrs.src as string) || '';
    const filename = (n.attrs.filename as string) || '(未命名)';
    const mimeType = (n.attrs.mimeType as string) || '';
    const size = n.attrs.size as number | null | undefined;

    iconEl.textContent = iconForMime(mimeType);
    nameEl.textContent = filename;
    const bits: string[] = [];
    if (mimeType) bits.push(mimeType);
    const s = formatSize(size ?? undefined);
    if (s) bits.push(s);
    subEl.textContent = bits.join(' · ');

    openBtn.disabled = !src;
    revealBtn.disabled = !src;
  }

  render(node);

  const api = (window as any).viewAPI;

  openBtn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    const src = (node.attrs.src as string) || '';
    if (!src) return;
    // media:// URLs render via the registered protocol handler; Electron
    // will open them in the default browser (or shell) which handles most
    // common types (pdf/html/image/text). For obscure types this still
    // works because the protocol returns the raw bytes with mimeType.
    api?.openExternal?.(src);
  });

  revealBtn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    const src = (node.attrs.src as string) || '';
    if (!src) return;
    // main 侧的 showItemInFolder 需要真实磁盘路径。我们传 media:// URL
    // 过去；main handler 可以之后增强做解析。暂时用 openExternal 作为
    // 兜底行为（打开文件本身而非 folder）。
    api?.showItemInFolder?.(src);
  });

  return {
    dom,
    update(updated) {
      if (updated.type.name !== 'fileBlock') return false;
      render(updated);
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
