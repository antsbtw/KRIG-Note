import type { BlockDef, NodeViewFactory } from '../types';
import type { Node as PMNode } from 'prosemirror-model';

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

const externalRefNodeView: NodeViewFactory = (node, _view, _getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('external-ref');
  dom.setAttribute('contenteditable', 'false');
  dom.dataset.atomType = 'externalRef';

  const inner = document.createElement('div');
  inner.classList.add('external-ref__inner');
  dom.appendChild(inner);

  const iconEl = document.createElement('div');
  iconEl.classList.add('external-ref__icon');
  inner.appendChild(iconEl);

  const meta = document.createElement('div');
  meta.classList.add('external-ref__meta');
  inner.appendChild(meta);

  const titleEl = document.createElement('div');
  titleEl.classList.add('external-ref__title');
  meta.appendChild(titleEl);

  const subEl = document.createElement('div');
  subEl.classList.add('external-ref__sub');
  meta.appendChild(subEl);

  const actions = document.createElement('div');
  actions.classList.add('external-ref__actions');
  inner.appendChild(actions);

  const openBtn = document.createElement('button');
  openBtn.classList.add('external-ref__btn');
  openBtn.textContent = '打开';
  actions.appendChild(openBtn);

  const revealBtn = document.createElement('button');
  revealBtn.classList.add('external-ref__btn');
  revealBtn.textContent = '在 Finder 显示';
  actions.appendChild(revealBtn);

  function render(n: PMNode) {
    const kind = (n.attrs.kind as 'file' | 'url') || 'url';
    const href = (n.attrs.href as string) || '';
    const title = (n.attrs.title as string) || '';

    const decoded = decodeHref(href);
    iconEl.textContent = kind === 'file' ? '📁' : '🌐';
    titleEl.textContent = title || decoded.display || '(无标题)';
    subEl.textContent = kind === 'file' ? (decoded.localPath || '') : (decoded.display || '');

    openBtn.disabled = !href;
    // Reveal 只对本机文件有意义
    revealBtn.style.display = kind === 'file' ? '' : 'none';
    revealBtn.disabled = !href;
  }

  render(node);

  const api = (window as any).viewAPI;

  openBtn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    const href = (node.attrs.href as string) || '';
    if (!href) return;
    // Electron 的 shell.openExternal 既能处理 https:// 也能处理 file://
    // ，按需分流。
    api?.openExternal?.(href);
  });

  revealBtn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    const kind = (node.attrs.kind as 'file' | 'url') || 'url';
    if (kind !== 'file') return;
    const href = (node.attrs.href as string) || '';
    const decoded = decodeHref(href);
    if (decoded.localPath) {
      api?.showItemInFolder?.(decoded.localPath);
    }
  });

  return {
    dom,
    update(updated) {
      if (updated.type.name !== 'externalRef') return false;
      render(updated);
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
