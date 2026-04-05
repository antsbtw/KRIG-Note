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

// 眼睛图标：toggle 代码显隐（split ↔ preview）
const ICON_EYE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_COPY = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const ICON_DOWNLOAD = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
const ICON_FULLSCREEN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';

let mermaidIdCounter = 0;
type ViewMode = 'split' | 'preview';

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
  const btnToggle = createBtn(ICON_EYE, '切换代码/预览');
  const mermaidSep = document.createElement('div');
  mermaidSep.classList.add('code-block__toolbar-sep');
  const btnDownload = createBtn(ICON_DOWNLOAD, '下载图片');
  const btnFullscreen = createBtn(ICON_FULLSCREEN, '全屏');

  function insertMermaidBtns() {
    if (mermaidBtnsInserted) return;
    toolbar.insertBefore(btnToggle, spacer);
    toolbar.insertBefore(mermaidSep, spacer);
    toolbar.insertBefore(btnDownload, spacer);
    toolbar.insertBefore(btnFullscreen, spacer);
    mermaidBtnsInserted = true;
  }

  function removeMermaidBtns() {
    if (!mermaidBtnsInserted) return;
    btnToggle.remove();
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

  // ── 模式切换（split ↔ preview） ──
  function updateViewMode(mode: ViewMode) {
    viewMode = mode;
    btnToggle.classList.toggle('code-block__toolbar-btn--active', mode === 'preview');
    btnToggle.title = mode === 'split' ? '隐藏代码' : '显示代码';

    if (node.attrs.language !== 'mermaid') return;
    pre.style.display = mode === 'preview' ? 'none' : '';
    dom.classList.toggle('code-block--preview-only', mode === 'preview');
    preview.style.display = 'flex';
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

  btnToggle.addEventListener('mousedown', (e) => {
    e.preventDefault(); e.stopPropagation();
    updateViewMode(viewMode === 'split' ? 'preview' : 'split');
  });

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

  // ── 全屏编辑 ──
  btnFullscreen.addEventListener('mousedown', (e) => {
    e.preventDefault(); e.stopPropagation();
    openFullscreenEditor();
  });

  function openFullscreenEditor() {
    const overlay = document.createElement('div');
    overlay.classList.add('code-block__fullscreen-overlay');

    // 顶部工具栏
    const fsToolbar = document.createElement('div');
    fsToolbar.classList.add('code-block__fs-toolbar');

    const fsTitle = document.createElement('span');
    fsTitle.classList.add('code-block__fs-title');
    fsTitle.textContent = 'Mermaid Editor';
    fsToolbar.appendChild(fsTitle);

    const fsSpacer = document.createElement('div');
    fsSpacer.style.flex = '1';
    fsToolbar.appendChild(fsSpacer);

    // 下载按钮
    const fsBtnDownload = document.createElement('button');
    fsBtnDownload.classList.add('code-block__fs-btn');
    fsBtnDownload.innerHTML = ICON_DOWNLOAD;
    fsBtnDownload.title = '下载 PNG';
    fsToolbar.appendChild(fsBtnDownload);

    // 关闭按钮
    const fsBtnClose = document.createElement('button');
    fsBtnClose.classList.add('code-block__fs-btn');
    fsBtnClose.innerHTML = '&times;';
    fsBtnClose.title = '关闭 (Esc)';
    fsBtnClose.style.fontSize = '20px';
    fsToolbar.appendChild(fsBtnClose);

    overlay.appendChild(fsToolbar);

    // 编辑区（左右分屏）
    const editorArea = document.createElement('div');
    editorArea.classList.add('code-block__fs-editor');

    // 左：代码编辑
    const editorPane = document.createElement('div');
    editorPane.classList.add('code-block__fs-code');
    const textarea = document.createElement('textarea');
    textarea.classList.add('code-block__fs-textarea');
    textarea.value = code.textContent || '';
    textarea.spellcheck = false;
    editorPane.appendChild(textarea);
    editorArea.appendChild(editorPane);

    // 中：可拖拽分隔线
    const divider = document.createElement('div');
    divider.classList.add('code-block__fs-divider');
    editorArea.appendChild(divider);

    // 右：预览
    const previewPane = document.createElement('div');
    previewPane.classList.add('code-block__fs-preview');

    const previewWrapper = document.createElement('div');
    previewWrapper.classList.add('code-block__fs-preview-wrapper');
    previewPane.appendChild(previewWrapper);
    editorArea.appendChild(previewPane);

    overlay.appendChild(editorArea);
    document.body.appendChild(overlay);

    // 分隔线拖拽
    let dividerDragging = false;
    divider.addEventListener('mousedown', (e) => {
      e.preventDefault();
      dividerDragging = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });
    const onDividerMove = (e: MouseEvent) => {
      if (!dividerDragging) return;
      const rect = editorArea.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const total = rect.width;
      const ratio = Math.max(0.15, Math.min(0.85, x / total));
      editorPane.style.flex = 'none';
      editorPane.style.width = `${ratio * 100}%`;
      previewPane.style.flex = 'none';
      previewPane.style.width = `${(1 - ratio) * 100}%`;
    };
    const onDividerUp = () => {
      if (!dividerDragging) return;
      dividerDragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onDividerMove);
    document.addEventListener('mouseup', onDividerUp);

    // 预览渲染
    let fsRenderTimer: ReturnType<typeof setTimeout> | null = null;
    let fsIdCounter = 0;

    async function renderFsPreview(source: string) {
      const trimmed = source.replace(/[\u200B\u200C\u200D\uFEFF]/g, '').trim();
      if (!trimmed) {
        previewWrapper.innerHTML = '<div class="code-block__mermaid-empty">输入 Mermaid 语法查看预览</div>';
        return;
      }
      await ensureMermaidInit();
      const renderId = `fs-mermaid-${++fsIdCounter}`;
      try {
        const { svg } = await mermaidModule.render(renderId, trimmed);
        previewWrapper.innerHTML = svg;
      } catch {
        previewWrapper.innerHTML = '<div class="code-block__mermaid-error">Mermaid 语法错误</div>';
        document.getElementById('d' + renderId)?.remove();
      }
    }

    function scheduleFsRender() {
      if (fsRenderTimer) clearTimeout(fsRenderTimer);
      fsRenderTimer = setTimeout(() => renderFsPreview(textarea.value), 300);
    }

    // 初始渲染
    renderFsPreview(textarea.value);

    // 实时编辑 → 预览
    textarea.addEventListener('input', scheduleFsRender);

    // Tab 插入空格
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 2;
        scheduleFsRender();
      }
    });

    // 预览区缩放 + 平移
    let scale = 1, panX = 0, panY = 0;
    const applyTransform = () => {
      previewWrapper.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    };

    previewPane.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const rect = previewPane.getBoundingClientRect();
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
    previewPane.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      dragging = true; lastX = ev.clientX; lastY = ev.clientY;
      previewPane.style.cursor = 'grabbing';
    });
    const onMove = (ev: MouseEvent) => {
      if (!dragging) return;
      panX += ev.clientX - lastX; panY += ev.clientY - lastY;
      lastX = ev.clientX; lastY = ev.clientY;
      applyTransform();
    };
    const onUp = () => { dragging = false; previewPane.style.cursor = 'grab'; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);

    // 下载 PNG
    fsBtnDownload.addEventListener('click', () => {
      const svgEl = previewWrapper.querySelector('svg');
      if (svgEl) exportSvgAsPng(svgEl, 'mermaid-diagram.png');
    });

    // 关闭 → 同步内容回 ProseMirror
    const close = () => {
      const newContent = textarea.value;
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos != null) {
        const currentNode = view.state.doc.nodeAt(pos);
        if (currentNode && currentNode.textContent !== newContent) {
          const tr = view.state.tr;
          // 替换 codeBlock 内部文本
          const start = pos + 1;
          const end = pos + currentNode.nodeSize - 1;
          if (newContent) {
            tr.replaceWith(start, end, view.state.schema.text(newContent));
          } else {
            tr.delete(start, end);
          }
          view.dispatch(tr);
        }
      }
      overlay.remove();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('mousemove', onDividerMove);
      document.removeEventListener('mouseup', onDividerUp);
      document.removeEventListener('keydown', onKey);
      if (fsRenderTimer) clearTimeout(fsRenderTimer);
      view.focus();
    };

    fsBtnClose.addEventListener('click', close);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);

    // 自动聚焦编辑区
    setTimeout(() => textarea.focus(), 50);
  }

  // ── Mermaid 渲染 ──
  async function renderMermaid(source: string) {
    if (node.attrs.language !== 'mermaid') { preview.style.display = 'none'; return; }

    const trimmed = source.replace(/[\u200B\u200C\u200D\uFEFF]/g, '').trim();
    if (!trimmed) {
      preview.style.display = 'flex';
      preview.innerHTML = '<div class="code-block__mermaid-empty">输入 Mermaid 语法查看预览</div>';
      return;
    }

    await ensureMermaidInit();
    const renderId = `mermaid-${++mermaidIdCounter}`;
    try {
      const { svg } = await mermaidModule.render(renderId, trimmed);
      preview.style.display = 'flex';
      preview.innerHTML = svg;
    } catch {
      preview.style.display = 'flex';
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
