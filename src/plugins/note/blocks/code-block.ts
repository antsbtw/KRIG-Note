import type { BlockDef, NodeViewFactory } from '../types';
import { codeBlockKeyboardPlugin } from '../plugins/code-block-keyboard';
import { EditorView as CMView, lineNumbers, keymap as cmKeymap } from '@codemirror/view';
import { EditorState as CMState } from '@codemirror/state';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { mermaidLanguage } from './mermaid-lang';
import { showMermaidPanel, hideMermaidPanel } from '../help-panel/mermaid';
import { saveBlobFile, saveTextFile, SVG_FILTERS } from '../utils/save-file';
import { getCodePlugin } from './code-plugins';
import type { CodeLanguagePlugin } from './code-plugins';
import { renderMermaidDiagram, getMermaidModule, buildMermaidConfig } from './code-plugins/mermaid-plugin';
import { openMermaidFullscreen } from './code-plugins/mermaid-fullscreen';

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
export const ICON_EYE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
export const ICON_COPY = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
export const ICON_DOWNLOAD = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
export const ICON_FULLSCREEN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';

export const ICON_FIT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>';
export const ICON_CLIPBOARD = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>';

// Mermaid 主题 + 模板 → 已迁移到 code-plugins/mermaid-plugin.ts

// ── CodeMirror 暗色主题 ──

export const cmDarkTheme = CMView.theme({
  '&': { backgroundColor: '#1e1e1e', color: '#d4d4d4', height: '100%' },
  '.cm-content': { caretColor: '#e8eaed', fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace", fontSize: '14px', lineHeight: '1.6' },
  '.cm-cursor': { borderLeftColor: '#e8eaed' },
  '.cm-gutters': { backgroundColor: '#1a1a1a', color: '#555', borderRight: '1px solid #2a2a2a' },
  '.cm-activeLineGutter': { backgroundColor: '#252525', color: '#888' },
  '.cm-activeLine': { backgroundColor: '#252525' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: '#264f78 !important' },
  '.cm-matchingBracket': { backgroundColor: '#3a3a3a', outline: '1px solid #555' },
}, { dark: true });

export const cmDarkHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#569cd6' },
  { tag: tags.comment, color: '#6a9955', fontStyle: 'italic' },
  { tag: tags.string, color: '#ce9178' },
  { tag: tags.number, color: '#b5cea8' },
  { tag: tags.operator, color: '#d4d4d4', fontWeight: 'bold' },
  { tag: tags.variableName, color: '#9cdcfe' },
  { tag: tags.attributeName, color: '#dcdcaa' },
  { tag: tags.punctuation, color: '#808080' },
]);

// mermaidIdCounter → 已迁移到 mermaid-plugin.ts
type ViewMode = 'split' | 'preview';

// ── NodeView ──

const codeBlockNodeView: NodeViewFactory = (node, view, getPos) => {
  let renderTimer: ReturnType<typeof setTimeout> | null = null;
  const LS_VIEW_KEY = 'krig-mermaid-view-mode';
  let viewMode: ViewMode = (localStorage.getItem(LS_VIEW_KEY) as ViewMode) || 'split';

  // 查询当前语言的插件
  let currentPlugin: CodeLanguagePlugin | null = getCodePlugin(node.attrs.language || '');

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

  // 左侧：标题（可选，Canvas 等场景）
  const titleEl = document.createElement('span');
  titleEl.classList.add('code-block__title');
  if (node.attrs.title) {
    titleEl.textContent = `📄 ${node.attrs.title}`;
    titleEl.style.display = '';
  } else {
    titleEl.style.display = 'none';
  }
  toolbar.appendChild(titleEl);

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

  // ── 预览区（插件可用时显示） ──
  const preview = document.createElement('div');
  preview.classList.add('code-block__preview');
  // Mermaid 向后兼容：保留原 CSS 类
  if (node.attrs.language === 'mermaid') preview.classList.add('code-block__mermaid');
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

  /** 上一次 isMermaid 状态，用于检测 language 切换 */
  let wasMermaid = node.attrs.language === 'mermaid';

  function updateToolbarVisibility() {
    const isMermaid = node.attrs.language === 'mermaid';
    dom.classList.toggle('code-block--mermaid', isMermaid);
    if (isMermaid) {
      insertMermaidBtns();
    } else {
      removeMermaidBtns();
      // 只在从 mermaid 切走时关闭面板（避免其他 code-block 初始化时误关）
      if (wasMermaid) {
        hideMermaidPanel();
      }
    }
    wasMermaid = isMermaid;
  }

  /** 打开 Mermaid 面板（点击进入 mermaid code-block 时调用） */
  function openMermaidPanel() {
    if (node.attrs.language !== 'mermaid') return;
    showMermaidPanel((mermaidCode: string) => {
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos == null) return;
      const pmNode = view.state.doc.nodeAt(pos);
      if (!pmNode) return;
      const start = pos + 1;
      const end = pos + pmNode.nodeSize - 1;
      const tr = view.state.tr.insertText(mermaidCode, start, end);
      view.dispatch(tr);
      view.focus();
    });
  }

  // 点击 code-block 时，如果是 mermaid 则打开面板
  dom.addEventListener('mousedown', () => {
    if (node.attrs.language === 'mermaid') {
      openMermaidPanel();
    }
  });

  btnToggle.addEventListener('mousedown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const next = viewMode === 'split' ? 'preview' : 'split';
    updateViewMode(next);
    localStorage.setItem(LS_VIEW_KEY, next);
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
    const svgEl = preview.querySelector('svg') as SVGElement | null;
    if (!svgEl) return;
    // 内联 SVG → PNG 导出
    const clone = svgEl.cloneNode(true) as SVGElement;
    const vb = svgEl.getAttribute('viewBox');
    if (vb) { const p = vb.split(/\s+/).map(Number); clone.setAttribute('width', String(p[2] || 800)); clone.setAttribute('height', String(p[3] || 600)); }
    const svgData = new XMLSerializer().serializeToString(clone);
    const dataUri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth * 2; canvas.height = img.naturalHeight * 2;
      const ctx = canvas.getContext('2d')!; ctx.scale(2, 2); ctx.drawImage(img, 0, 0);
      canvas.toBlob((b) => { if (b) saveBlobFile({ defaultName: 'mermaid-diagram.png', blob: b, filters: SVG_FILTERS }); }, 'image/png');
    };
    img.src = dataUri;
  });

  // ── 全屏编辑 ──
  btnFullscreen.addEventListener('mousedown', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (currentPlugin?.openFullscreen) {
      currentPlugin.openFullscreen(buildPluginContext());
    }
  });


  // ── Mermaid 渲染（委托给 mermaid-plugin） ──
  async function renderMermaid(source: string) {
    if (node.attrs.language !== 'mermaid') { preview.style.display = 'none'; return; }
    await renderMermaidDiagram(source, preview);
  }

  function scheduleRender() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => renderMermaid(code.textContent || ''), 500);
  }

  // 构建插件上下文（供插件调用）
  function buildPluginContext() {
    return {
      node,
      view,
      getPos,
      codeElement: code,
      previewElement: preview,
      dom,
      getCode: () => code.textContent || '',
      updateAttrs: (attrs: Record<string, unknown>) => {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (pos == null) return;
        let tr = view.state.tr;
        for (const [key, value] of Object.entries(attrs)) {
          tr = tr.setNodeAttribute(pos, key, value);
        }
        view.dispatch(tr);
      },
    };
  }

  // MutationObserver 监听代码变化
  const observer = new MutationObserver(() => {
    if (node.attrs.language === 'mermaid') {
      scheduleRender();
    } else if (currentPlugin?.hasPreview && currentPlugin.schedulePreview) {
      currentPlugin.schedulePreview(code.textContent || '', preview, buildPluginContext());
    } else if (currentPlugin?.hasPreview && currentPlugin.renderPreview) {
      currentPlugin.renderPreview(code.textContent || '', preview, buildPluginContext());
    }
  });
  observer.observe(code, { childList: true, characterData: true, subtree: true });

  // 初始化
  updateToolbarVisibility();
  if (node.attrs.language === 'mermaid') {
    updateViewMode(viewMode);
    setTimeout(() => renderMermaid(code.textContent || ''), 50);
  } else if (currentPlugin?.hasPreview) {
    preview.style.display = 'flex';
    setTimeout(() => {
      currentPlugin?.activate?.(buildPluginContext());
    }, 50);
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
      // 语言变更时切换插件
      if (langChanged) {
        const oldPlugin = currentPlugin;
        currentPlugin = getCodePlugin(node.attrs.language || '');
        // 停用旧插件
        if (oldPlugin && oldPlugin !== currentPlugin) {
          oldPlugin.deactivate?.(buildPluginContext());
        }
        // Mermaid CSS 兼容
        preview.classList.toggle('code-block__mermaid', node.attrs.language === 'mermaid');
      }
      // 同步标题
      if (node.attrs.title) {
        titleEl.textContent = `📄 ${node.attrs.title}`;
        titleEl.style.display = '';
      } else {
        titleEl.style.display = 'none';
      }
      langBtn.textContent = getLangLabel(node.attrs.language) + ' ∨';
      code.className = node.attrs.language ? `code-block__code language-${node.attrs.language}` : 'code-block__code';
      buildDropdown();
      updateToolbarVisibility();

      if (node.attrs.language === 'mermaid') {
        if (langChanged) { updateViewMode(viewMode); renderMermaid(node.textContent); openMermaidPanel(); }
        else scheduleRender();
      } else if (currentPlugin?.hasPreview) {
        // 非 Mermaid 的 Preview 插件
        preview.style.display = 'flex';
        if (langChanged) {
          currentPlugin.activate?.(buildPluginContext());
        } else if (currentPlugin.schedulePreview) {
          currentPlugin.schedulePreview(node.textContent, preview, buildPluginContext());
        } else if (currentPlugin.renderPreview) {
          currentPlugin.renderPreview(node.textContent, preview, buildPluginContext());
        }
      } else {
        preview.style.display = 'none';
      }
      return true;
    },
    destroy() {
      observer.disconnect();
      document.removeEventListener('mousedown', closeDropdown);
      if (renderTimer) clearTimeout(renderTimer);
      if (node.attrs.language === 'mermaid') hideMermaidPanel();
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
    attrs: {
      language: { default: '' },
      title: { default: '' },
    },
    parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' as const, getAttrs(dom: HTMLElement) {
      return { language: dom.getAttribute('data-language') || '', title: dom.getAttribute('data-title') || '' };
    }}],
    toDOM(node) { return ['pre', { 'data-language': node.attrs.language, 'data-title': node.attrs.title || undefined }, ['code', 0]]; },
  },
  nodeView: codeBlockNodeView,
  plugin: codeBlockKeyboardPlugin,
  enterBehavior: { action: 'newline', exitCondition: 'double-enter' },
  capabilities: { turnInto: ['textBlock'], canDelete: true, canDrag: true },
  slashMenu: { label: 'Code Block', icon: '</>', group: 'basic', keywords: ['code', 'pre', '代码'], order: 4 },
};
