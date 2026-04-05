import type { BlockDef, NodeViewFactory } from '../types';
import { codeBlockKeyboardPlugin } from '../plugins/code-block-keyboard';

/**
 * codeBlock — 代码块（RenderBlock）
 *
 * 功能：
 * - 语言选择下拉（20+ 语言，搜索过滤）
 * - Mermaid 三模式切换（代码/分屏/预览）
 * - 一键复制代码（成功变绿 ✓）
 * - 下载 PNG（SVG → Canvas → PNG，2x retina）
 * - 全屏查看（拖拽平移 + 滚轮缩放）
 * - MutationObserver 监听内容变化 → debounce 渲染
 */

// ── Mermaid 初始化 ──

let mermaidInitialized = false;
let mermaidModule: any = null;

async function ensureMermaidInit() {
  if (mermaidInitialized) return;
  mermaidInitialized = true;
  mermaidModule = (await import('mermaid')).default;

  try {
    const elkLayouts = (await import('@mermaid-js/layout-elk')).default;
    mermaidModule.registerLayoutLoaders(elkLayouts);
  } catch { /* ELK not available, use dagre */ }

  mermaidModule.initialize({
    startOnLoad: false,
    theme: 'dark',
    darkMode: true,
    securityLevel: 'loose',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: 16,
    flowchart: {
      useMaxWidth: true,
      htmlLabels: true,
      curve: 'basis',
      diagramPadding: 8,
      nodeSpacing: 30,
      rankSpacing: 40,
      padding: 12,
      wrappingWidth: 400,
      defaultRenderer: 'elk',
    },
  });
}

// ── 语言列表 ──

export const CODE_LANGUAGES = [
  '', 'javascript', 'typescript', 'python', 'rust', 'go', 'java', 'c', 'cpp',
  'html', 'css', 'json', 'yaml', 'toml', 'sql', 'bash', 'shell',
  'markdown', 'latex', 'mermaid', 'swift', 'kotlin', 'ruby', 'php', 'xml',
];

function getLangLabel(language: string | null): string {
  if (!language) return 'Plain Text';
  return language;
}

// ── SVG Icons ──

const ICON_CODE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';
const ICON_SPLIT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>';
const ICON_PREVIEW = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>';
const ICON_COPY = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const ICON_DOWNLOAD = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
const ICON_FULLSCREEN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';

let mermaidIdCounter = 0;
type ViewMode = 'code' | 'split' | 'preview';

// ── NodeView ──

const codeBlockNodeView: NodeViewFactory = (node, view, getPos) => {
  let renderTimer: ReturnType<typeof setTimeout> | null = null;
  let viewMode: ViewMode = 'split';

  const dom = document.createElement('div');
  dom.classList.add('code-block');

  // ── Toolbar ──
  const toolbar = document.createElement('div');
  toolbar.classList.add('code-block__toolbar');
  toolbar.setAttribute('contenteditable', 'false');
  dom.appendChild(toolbar);

  function createBtn(icon: string, title: string, cls?: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.classList.add('code-block__toolbar-btn');
    if (cls) btn.classList.add(cls);
    btn.innerHTML = icon;
    btn.title = title;
    return btn;
  }

  // 左侧：语言选择按钮
  const langBtn = document.createElement('button');
  langBtn.classList.add('code-block__lang-btn');
  langBtn.textContent = getLangLabel(node.attrs.language) + ' ∨';
  toolbar.appendChild(langBtn);

  // 语言下拉（挂在 dom 上，absolute 定位）
  const dropdown = document.createElement('div');
  dropdown.classList.add('code-block__dropdown');
  dropdown.setAttribute('contenteditable', 'false');
  dropdown.style.display = 'none';
  dom.appendChild(dropdown);

  const searchInput = document.createElement('input');
  searchInput.classList.add('code-block__dropdown-search');
  searchInput.placeholder = '搜索语言...';
  dropdown.appendChild(searchInput);

  const listContainer = document.createElement('div');
  listContainer.classList.add('code-block__dropdown-list');
  dropdown.appendChild(listContainer);

  function buildDropdown(filter?: string) {
    listContainer.innerHTML = '';
    const q = (filter || '').toLowerCase();
    for (const lang of CODE_LANGUAGES) {
      const label = lang || 'Plain Text';
      if (q && !label.toLowerCase().includes(q) && !lang.includes(q)) continue;
      const item = document.createElement('button');
      item.classList.add('code-block__dropdown-item');
      if (lang === (node.attrs.language || '')) item.classList.add('code-block__dropdown-item--active');

      const labelSpan = document.createElement('span');
      labelSpan.textContent = label;
      item.appendChild(labelSpan);

      if (lang === (node.attrs.language || '')) {
        const check = document.createElement('span');
        check.classList.add('code-block__dropdown-check');
        check.textContent = '✓';
        item.appendChild(check);
      }

      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (pos == null) return;
        view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, language: lang }));
        dropdown.style.display = 'none';
        searchInput.value = '';
      });
      listContainer.appendChild(item);
    }
  }
  buildDropdown();

  searchInput.addEventListener('input', () => buildDropdown(searchInput.value));
  searchInput.addEventListener('keydown', (e) => e.stopPropagation());

  langBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const isVisible = dropdown.style.display !== 'none';
    dropdown.style.display = isVisible ? 'none' : 'flex';
    if (!isVisible) {
      searchInput.value = '';
      buildDropdown();
      setTimeout(() => searchInput.focus(), 50);
    }
  });

  const closeDropdown = (e: MouseEvent) => {
    if (!dom.contains(e.target as Node)) dropdown.style.display = 'none';
  };
  document.addEventListener('mousedown', closeDropdown);

  // 右侧：复制按钮（始终在最右）
  const spacer = document.createElement('div');
  spacer.style.flex = '1';
  toolbar.appendChild(spacer);

  const btnCopy = createBtn(ICON_COPY, '复制代码');
  toolbar.appendChild(btnCopy);

  // ── Mermaid 扩展按钮（动态添加/移除） ──
  let mermaidBtnsInserted = false;
  const btnCode = createBtn(ICON_CODE, '仅代码', 'code-block__toolbar-btn--mode');
  const btnSplit = createBtn(ICON_SPLIT, '代码 + 预览', 'code-block__toolbar-btn--mode');
  const btnPreview = createBtn(ICON_PREVIEW, '仅预览', 'code-block__toolbar-btn--mode');
  const mermaidSep = document.createElement('div');
  mermaidSep.classList.add('code-block__toolbar-sep');
  const btnDownload = createBtn(ICON_DOWNLOAD, '下载图片');
  const btnFullscreen = createBtn(ICON_FULLSCREEN, '全屏');

  function insertMermaidBtns() {
    if (mermaidBtnsInserted) return;
    toolbar.insertBefore(btnCode, spacer);
    toolbar.insertBefore(btnSplit, spacer);
    toolbar.insertBefore(btnPreview, spacer);
    toolbar.insertBefore(mermaidSep, spacer);
    toolbar.insertBefore(btnDownload, spacer);
    toolbar.insertBefore(btnFullscreen, spacer);
    mermaidBtnsInserted = true;
  }

  function removeMermaidBtns() {
    if (!mermaidBtnsInserted) return;
    btnCode.remove();
    btnSplit.remove();
    btnPreview.remove();
    mermaidSep.remove();
    btnDownload.remove();
    btnFullscreen.remove();
    mermaidBtnsInserted = false;
  }

  // ── 代码区 ──
  const pre = document.createElement('pre');
  pre.classList.add('code-block__pre');
  const code = document.createElement('code');
  code.classList.add('code-block__code');
  if (node.attrs.language) code.classList.add(`language-${node.attrs.language}`);
  pre.appendChild(code);
  dom.appendChild(pre);

  // ── Mermaid 预览区 ──
  const preview = document.createElement('div');
  preview.classList.add('code-block__mermaid');
  preview.setAttribute('contenteditable', 'false');
  preview.style.display = 'none';
  dom.appendChild(preview);

  // ── 模式切换 ──
  function updateViewMode(mode: ViewMode) {
    viewMode = mode;
    btnCode.classList.toggle('code-block__toolbar-btn--active', mode === 'code');
    btnSplit.classList.toggle('code-block__toolbar-btn--active', mode === 'split');
    btnPreview.classList.toggle('code-block__toolbar-btn--active', mode === 'preview');

    if (node.attrs.language !== 'mermaid') return;
    pre.style.display = mode === 'preview' ? 'none' : '';
    dom.classList.toggle('code-block--preview-only', mode === 'preview');
    preview.style.display = mode === 'code' ? 'none' : 'flex';
  }

  function updateToolbarVisibility() {
    const isMermaid = node.attrs.language === 'mermaid';
    dom.classList.toggle('code-block--mermaid', isMermaid);
    if (isMermaid) {
      insertMermaidBtns();
    } else {
      removeMermaidBtns();
    }
  }

  btnCode.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); updateViewMode('code'); });
  btnSplit.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); updateViewMode('split'); });
  btnPreview.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); updateViewMode('preview'); });

  // ── 复制 ──
  btnCopy.addEventListener('mousedown', (e) => {
    e.preventDefault(); e.stopPropagation();
    navigator.clipboard.writeText(code.textContent || '').then(() => {
      btnCopy.classList.add('code-block__toolbar-btn--copied');
      btnCopy.title = '已复制！';
      setTimeout(() => { btnCopy.classList.remove('code-block__toolbar-btn--copied'); btnCopy.title = '复制代码'; }, 1500);
    });
  });

  // ── 下载 PNG ──
  btnDownload.addEventListener('mousedown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const svgEl = preview.querySelector('svg');
    if (!svgEl) return;
    exportSvgAsPng(svgEl, 'mermaid-diagram.png');
  });

  function exportSvgAsPng(svgEl: SVGElement, filename: string) {
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth * scale;
      canvas.height = img.naturalHeight * scale;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
      }, 'image/png');
    };
    img.src = url;
  }

  // ── 全屏 ──
  btnFullscreen.addEventListener('mousedown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const svgEl = preview.querySelector('svg');
    if (svgEl) showFullscreen(svgEl);
  });

  preview.addEventListener('click', (e) => {
    e.preventDefault();
    const svgEl = preview.querySelector('svg');
    if (svgEl) showFullscreen(svgEl);
  });

  function showFullscreen(svgEl: SVGElement) {
    const overlay = document.createElement('div');
    overlay.classList.add('code-block__fullscreen-overlay');

    const container = document.createElement('div');
    container.classList.add('code-block__fullscreen-container');

    const wrapper = document.createElement('div');
    wrapper.classList.add('code-block__fullscreen-wrapper');
    const svgClone = svgEl.cloneNode(true) as SVGElement;
    wrapper.appendChild(svgClone);
    container.appendChild(wrapper);

    const closeBtn = document.createElement('button');
    closeBtn.classList.add('code-block__fullscreen-close');
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Close (Esc)';
    overlay.appendChild(closeBtn);
    overlay.appendChild(container);
    document.body.appendChild(overlay);

    let scale = 1;
    let panX = 0, panY = 0;
    const applyTransform = () => { wrapper.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`; };

    requestAnimationFrame(() => {
      const vw = window.innerWidth * 0.9;
      const vh = window.innerHeight * 0.9;
      const svgRect = svgClone.getBoundingClientRect();
      const svgW = svgRect.width || 800;
      const svgH = svgRect.height || 600;
      const fitScale = Math.min(vw / svgW, vh / svgH, 3);
      scale = Math.max(fitScale, 0.5);
      applyTransform();
    });

    container.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const rect = container.getBoundingClientRect();
      const mx = ev.clientX - rect.left - rect.width / 2;
      const my = ev.clientY - rect.top - rect.height / 2;
      const oldScale = scale;
      scale = Math.max(0.2, Math.min(5, scale + (ev.deltaY > 0 ? -0.1 : 0.1)));
      const ratio = scale / oldScale;
      panX = mx - ratio * (mx - panX);
      panY = my - ratio * (my - panY);
      applyTransform();
    });

    let dragging = false, lastX = 0, lastY = 0;
    container.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      dragging = true; lastX = ev.clientX; lastY = ev.clientY;
      container.style.cursor = 'grabbing';
    });
    const onMove = (ev: MouseEvent) => {
      if (!dragging) return;
      panX += ev.clientX - lastX; panY += ev.clientY - lastY;
      lastX = ev.clientX; lastY = ev.clientY;
      applyTransform();
    };
    const onUp = () => { dragging = false; container.style.cursor = 'grab'; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);

    const close = () => {
      overlay.remove();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('keydown', onKey);
    };
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
  }

  // ── Mermaid 渲染 ──
  async function renderMermaid(source: string) {
    if (node.attrs.language !== 'mermaid') { preview.style.display = 'none'; return; }

    const trimmed = source.replace(/[\u200B\u200C\u200D\uFEFF]/g, '').trim();
    if (!trimmed) {
      if (viewMode !== 'code') preview.style.display = 'flex';
      preview.innerHTML = '<div class="code-block__mermaid-empty">输入 Mermaid 语法查看预览</div>';
      return;
    }

    await ensureMermaidInit();
    const renderId = `mermaid-${++mermaidIdCounter}`;
    try {
      const { svg } = await mermaidModule.render(renderId, trimmed);
      if (viewMode !== 'code') preview.style.display = 'flex';
      preview.innerHTML = svg;
    } catch {
      if (viewMode !== 'code') preview.style.display = 'flex';
      preview.innerHTML = '<div class="code-block__mermaid-error">Mermaid 语法错误</div>';
      document.getElementById('d' + renderId)?.remove();
    }
  }

  function scheduleRender() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => renderMermaid(code.textContent || ''), 500);
  }

  // MutationObserver 监听代码变化
  const observer = new MutationObserver(() => {
    if (node.attrs.language === 'mermaid') scheduleRender();
  });
  observer.observe(code, { childList: true, characterData: true, subtree: true });

  // 初始化
  updateToolbarVisibility();
  if (node.attrs.language === 'mermaid') {
    updateViewMode('split');
    setTimeout(() => renderMermaid(code.textContent || ''), 50);
  } else {
    preview.style.display = 'none';
  }

  return {
    dom,
    contentDOM: code,
    ignoreMutation(mutation: any) {
      return !code.contains(mutation.target);
    },
    update(updatedNode) {
      if (updatedNode.type.name !== 'codeBlock') return false;
      const langChanged = updatedNode.attrs.language !== node.attrs.language;
      node = updatedNode;
      langBtn.textContent = getLangLabel(node.attrs.language) + ' ∨';
      code.className = node.attrs.language ? `code-block__code language-${node.attrs.language}` : 'code-block__code';
      buildDropdown();
      updateToolbarVisibility();

      if (node.attrs.language === 'mermaid') {
        if (langChanged) { updateViewMode('split'); renderMermaid(node.textContent); }
        else scheduleRender();
      } else {
        preview.style.display = 'none';
      }
      return true;
    },
    destroy() {
      observer.disconnect();
      document.removeEventListener('mousedown', closeDropdown);
      if (renderTimer) clearTimeout(renderTimer);
    },
  };
};

// ── BlockDef ──

export const codeBlockBlock: BlockDef = {
  name: 'codeBlock',
  group: 'block',
  nodeSpec: {
    content: 'text*',
    group: 'block',
    code: true,
    defining: true,
    marks: '',
    attrs: { language: { default: '' } },
    parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' as const, getAttrs(dom: HTMLElement) {
      return { language: dom.getAttribute('data-language') || '' };
    }}],
    toDOM(node) { return ['pre', { 'data-language': node.attrs.language }, ['code', 0]]; },
  },
  nodeView: codeBlockNodeView,
  plugin: codeBlockKeyboardPlugin,
  enterBehavior: { action: 'newline', exitCondition: 'double-enter' },
  capabilities: { turnInto: ['textBlock'], canDelete: true, canDrag: true },
  slashMenu: { label: 'Code Block', icon: '</>', group: 'basic', keywords: ['code', 'pre', '代码'], order: 4 },
};
