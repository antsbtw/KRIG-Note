import type { BlockDef, NodeViewFactory } from '../types';

/**
 * fileLink — 行内文件链接（Inline atom）
 *
 * 渲染为可点击的 inline chip（📎 filename），点击用系统默认应用打开文件。
 * 用于段落中间引用附件文件（如 ChatGPT Code Interpreter sandbox 文件）。
 */

const api = () => (window as any).viewAPI as {
  mediaResolvePath: (src: string) => Promise<{ success: boolean; path: string }>;
  mediaOpenPath: (path: string) => void;
  showItemInFolder: (path: string) => void;
} | undefined;

async function resolveAndOpen(src: string): Promise<void> {
  const v = api();
  if (!v || !src) return;
  if (src.startsWith('media://') || src.startsWith('file://') || src.startsWith('/')) {
    try {
      const r = await v.mediaResolvePath(src);
      if (r?.success && r.path) {
        v.mediaOpenPath(r.path);
      }
    } catch { /* ignore */ }
  }
}

async function resolveAndShowInFinder(src: string): Promise<void> {
  const v = api();
  if (!v || !src) return;
  if (src.startsWith('media://') || src.startsWith('file://') || src.startsWith('/')) {
    try {
      const r = await v.mediaResolvePath(src);
      if (r?.success && r.path) {
        v.showItemInFolder(r.path);
      }
    } catch { /* ignore */ }
  }
}

const fileLinkNodeView: NodeViewFactory = (node, _view, _getPos) => {
  const dom = document.createElement('span');
  dom.classList.add('file-link');
  dom.setAttribute('contenteditable', 'false');

  let currentSrc = node.attrs.src as string;
  let currentFilename = node.attrs.filename as string;

  function render() {
    dom.innerHTML = '';
    const icon = document.createElement('span');
    icon.classList.add('file-link-icon');
    icon.textContent = '📎';
    const name = document.createElement('span');
    name.classList.add('file-link-name');
    name.textContent = currentFilename || 'file';
    dom.appendChild(icon);
    dom.appendChild(name);
    dom.title = currentSrc || '';
  }

  render();

  // 单击 → 打开文件
  dom.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (currentSrc) resolveAndOpen(currentSrc);
  });

  // 右键菜单
  dom.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!currentSrc) return;

    const menu = document.createElement('div');
    menu.classList.add('file-link-menu');
    menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:9999;background:#fff;border:1px solid #ddd;border-radius:6px;padding:4px 0;box-shadow:0 2px 8px rgba(0,0,0,.15);font-size:13px;`;

    const items = [
      { label: '打开文件', action: () => resolveAndOpen(currentSrc) },
      { label: '在 Finder 中显示', action: () => resolveAndShowInFinder(currentSrc) },
      { label: '复制路径', action: () => navigator.clipboard.writeText(currentSrc) },
    ];

    for (const item of items) {
      const row = document.createElement('div');
      row.textContent = item.label;
      row.style.cssText = 'padding:4px 12px;cursor:pointer;';
      row.addEventListener('mouseenter', () => { row.style.background = '#f0f0f0'; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; });
      row.addEventListener('click', () => { item.action(); menu.remove(); });
      menu.appendChild(row);
    }

    document.body.appendChild(menu);
    const dismiss = () => { menu.remove(); document.removeEventListener('click', dismiss); };
    setTimeout(() => document.addEventListener('click', dismiss), 0);
  });

  return {
    dom,
    update(updatedNode) {
      if (updatedNode.type.name !== 'fileLink') return false;
      const newSrc = updatedNode.attrs.src as string;
      const newFilename = updatedNode.attrs.filename as string;
      if (newSrc !== currentSrc || newFilename !== currentFilename) {
        currentSrc = newSrc;
        currentFilename = newFilename;
        render();
      }
      return true;
    },
    stopEvent() { return true; },
    ignoreMutation() { return true; },
  };
};

export const fileLinkBlock: BlockDef = {
  name: 'fileLink',
  group: 'inline',
  nodeSpec: {
    inline: true,
    group: 'inline',
    atom: true,
    attrs: {
      src: { default: '' },
      filename: { default: '' },
    },
    parseDOM: [{ tag: 'span.file-link', getAttrs(dom: HTMLElement) {
      return {
        src: dom.getAttribute('data-src') || '',
        filename: dom.querySelector('.file-link-name')?.textContent || dom.textContent?.replace(/^📎\s*/, '') || '',
      };
    }}],
    toDOM(node) {
      return ['span', { class: 'file-link', 'data-src': node.attrs.src },
        ['span', { class: 'file-link-icon' }, '📎'],
        ['span', { class: 'file-link-name' }, node.attrs.filename || 'file'],
      ];
    },
  },
  nodeView: fileLinkNodeView,
  capabilities: {},
  slashMenu: null,
};
