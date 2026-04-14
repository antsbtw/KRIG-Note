import type { BlockDef, NodeViewFactory } from '../types';
import type { Node as PMNode } from 'prosemirror-model';
import { createPlaceholder } from './render-block-base';

/**
 * externalRef — 对外部资源的一等引用（block）
 *
 * 两种 kind：
 *   - `file`：本机路径，href 为 `file:///absolute/path`
 *   - `url`：网络链接，href 为 `https://...`
 *
 * 区别于 link mark 和 fileBlock：
 *   - link mark 是文字上的样式，数据不在 Atom 树上（无法参与 Graph）
 *   - fileBlock 会把字节复制进 KRIG media store，自包含
 *   - externalRef 只是一个"引用卡片"，文件/网页本身不在 KRIG 里。
 *     优势是轻量，适合表达"这篇 note 引用了系统里的 X"的知识结构，
 *     未来可被 Graph 查询（note → external file → folder → ...）
 *
 * NodeView 是只读卡片：kind icon + title + host/path 摘要 + [打开]
 * （kind=file 再加 [在 Finder 显示]）。
 */

function decodeHref(href: string): { kind: 'file' | 'url'; display: string; localPath: string | null } {
  if (href.startsWith('file:')) {
    try {
      const u = new URL(href);
      return { kind: 'file', display: decodeURIComponent(u.pathname), localPath: decodeURIComponent(u.pathname) };
    } catch {
      return { kind: 'file', display: href, localPath: href.replace(/^file:\/\//, '') };
    }
  }
  try {
    const u = new URL(href);
    return { kind: 'url', display: u.host + u.pathname, localPath: null };
  } catch {
    return { kind: 'url', display: href, localPath: null };
  }
}

/**
 * Encode a browser-picked File path into a `file:///...` URI.
 *
 * Electron ≥ v32 no longer exposes `File.path` to renderer JS (security).
 * We call the preload-exposed `viewAPI.getFilePath(file)` which wraps
 * `webUtils.getPathForFile` — the only sanctioned way to recover the
 * absolute path in modern Electron. Returns an empty string if no path
 * is available (e.g. file from a Blob URL or non-file source).
 */
function fileToFileHref(file: File): string {
  const api = (window as any).viewAPI;
  const p: string = api?.getFilePath?.(file) || (file as any).path || '';
  if (!p) return '';
  const enc = p.split('/').map(s => s ? encodeURIComponent(s) : '').join('/');
  return `file://${enc}`;
}

const externalRefNodeView: NodeViewFactory = (initialNode, view, getPos) => {
  let node = initialNode;

  // Follow KRIG render-block convention so global block-handle plugin
  // and hover styles work automatically (matches image/video/tweet).
  const dom = document.createElement('div');
  dom.classList.add('render-block', 'render-block--externalRef');
  dom.dataset.atomType = 'externalRef';

  dom.addEventListener('mouseenter', () => dom.classList.add('render-block--hovered'));
  dom.addEventListener('mouseleave', () => dom.classList.remove('render-block--hovered'));

  const api = (window as any).viewAPI;

  const updateAttrs = (attrs: Record<string, unknown>) => {
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos == null) return;
    let tr = view.state.tr;
    for (const [key, value] of Object.entries(attrs)) {
      tr = tr.setNodeAttribute(pos, key, value);
    }
    view.dispatch(tr);
  };

  const renderCard = (n: PMNode) => {
    dom.innerHTML = '';
    const content = document.createElement('div');
    content.classList.add('render-block__content', 'external-ref');
    dom.appendChild(content);

    const kind = (n.attrs.kind as 'file' | 'url') || 'url';
    const href = (n.attrs.href as string) || '';
    const title = (n.attrs.title as string) || '';
    const decoded = decodeHref(href);

    const inner = document.createElement('div');
    inner.classList.add('external-ref__inner');

    const iconEl = document.createElement('div');
    iconEl.classList.add('external-ref__icon');
    iconEl.textContent = kind === 'file' ? '📁' : '🌐';
    inner.appendChild(iconEl);

    const meta = document.createElement('div');
    meta.classList.add('external-ref__meta');
    const titleEl = document.createElement('div');
    titleEl.classList.add('external-ref__title');
    titleEl.textContent = title || decoded.display || '(无标题)';
    meta.appendChild(titleEl);
    const subEl = document.createElement('div');
    subEl.classList.add('external-ref__sub');
    subEl.textContent = kind === 'file' ? (decoded.localPath || '') : (decoded.display || '');
    meta.appendChild(subEl);
    inner.appendChild(meta);

    const actions = document.createElement('div');
    actions.classList.add('external-ref__actions');

    const openBtn = document.createElement('button');
    openBtn.classList.add('external-ref__btn');
    openBtn.textContent = '打开';
    openBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const h = (node.attrs.href as string) || '';
      if (!h) return;
      // file:// URLs: resolve to local path + shell.openPath (OS respects
      // default-handler mapping for file extensions). Others: openExternal
      // in the system browser.
      if (h.startsWith('file:')) {
        const d = decodeHref(h);
        if (d.localPath) api?.mediaOpenPath?.(d.localPath);
      } else {
        api?.openExternal?.(h);
      }
    });
    actions.appendChild(openBtn);

    if (kind === 'file') {
      const revealBtn = document.createElement('button');
      revealBtn.classList.add('external-ref__btn');
      revealBtn.textContent = '在 Finder 显示';
      revealBtn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const d = decodeHref((node.attrs.href as string) || '');
        if (d.localPath) api?.showItemInFolder?.(d.localPath);
      });
      actions.appendChild(revealBtn);
    }

    inner.appendChild(actions);
    content.appendChild(inner);
  };

  const renderPlaceholder = () => {
    dom.innerHTML = '';
    const content = document.createElement('div');
    content.classList.add('render-block__content', 'external-ref');
    dom.appendChild(content);
    const placeholder = createPlaceholder({
      icon: '🔗',
      uploadLabel: 'Pick a file',
      uploadAccept: '*/*',
      embedLabel: 'URL',
      embedPlaceholder: 'https://... or file:///...',
      onUpload: (_dataUrl, file) => {
        if (!file) return;
        const href = fileToFileHref(file);
        if (!href) {
          // eslint-disable-next-line no-console
          console.warn('[externalRef] Could not resolve file path — cannot create reference. The file may have been dropped from a non-disk source.');
          return;
        }
        updateAttrs({
          kind: 'file',
          href,
          title: file.name,
          mimeType: file.type || '',
          size: file.size ?? null,
          modifiedAt: (file as any).lastModified ?? null,
        });
      },
      onEmbed: (raw) => {
        const trimmed = raw.trim();
        if (!trimmed) return;
        const isFile = trimmed.startsWith('file:') || trimmed.startsWith('/');
        const href = isFile && trimmed.startsWith('/')
          ? `file://${trimmed.split('/').map(s => s ? encodeURIComponent(s) : '').join('/')}`
          : trimmed;
        updateAttrs({ kind: isFile ? 'file' : 'url', href, title: '' });
      },
    });
    content.appendChild(placeholder);
  };

  const paint = (n: PMNode) => {
    if (n.attrs.href) renderCard(n);
    else renderPlaceholder();
  };

  paint(node);

  return {
    dom,
    update(updated) {
      if (updated.type.name !== 'externalRef') return false;
      const hadHref = !!node.attrs.href;
      const hasHref = !!updated.attrs.href;
      node = updated;
      if (hadHref !== hasHref) paint(node);
      else if (hasHref) renderCard(node);
      return true;
    },
  };
};

export const externalRefBlock: BlockDef = {
  name: 'externalRef',
  group: 'block',
  nodeSpec: {
    group: 'block',
    atom: true,
    draggable: true,
    selectable: true,
    attrs: {
      atomId:     { default: null },
      kind:       { default: 'url' },       // 'file' | 'url'
      href:       { default: '' },
      title:      { default: '' },
      mimeType:   { default: '' },
      size:       { default: null },
      modifiedAt: { default: null },
    },
    parseDOM: [{
      tag: 'div.external-ref',
      getAttrs(dom: HTMLElement) {
        return {
          kind:     (dom.getAttribute('data-kind') as 'file' | 'url') || 'url',
          href:     dom.getAttribute('data-href') || '',
          title:    dom.getAttribute('data-title') || '',
          mimeType: dom.getAttribute('data-mime') || '',
          size:     dom.getAttribute('data-size') ? Number(dom.getAttribute('data-size')) : null,
        };
      },
    }],
    toDOM(node: PMNode) {
      return ['div', {
        class: 'external-ref',
        'data-kind':  node.attrs.kind || 'url',
        'data-href':  node.attrs.href || '',
        'data-title': node.attrs.title || '',
        'data-mime':  node.attrs.mimeType || '',
        'data-size':  node.attrs.size != null ? String(node.attrs.size) : '',
      }];
    },
  },
  nodeView: externalRefNodeView,
  capabilities: { canDelete: true, canDrag: true },
  slashMenu: { label: 'External reference', icon: '🔗', group: 'media', keywords: ['ref', 'link', 'file', 'url', '引用'], order: 5 },
};
