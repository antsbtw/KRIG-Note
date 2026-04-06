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

function buildMermaidConfig(theme: string = 'dark') {
  return {
    startOnLoad: false,
    theme,
    darkMode: theme === 'dark',
    securityLevel: 'loose',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: 16,
    flowchart: {
      useMaxWidth: true,
      htmlLabels: true,
      curve: 'monotoneY',
      diagramPadding: 16,
      nodeSpacing: 50,
      rankSpacing: 60,
      padding: 15,
      wrappingWidth: 400,
      defaultRenderer: 'elk',
    },
  };
}

async function ensureMermaidInit() {
  if (mermaidInitialized) return;
  mermaidInitialized = true;
  mermaidModule = (await import('mermaid')).default;

  try {
    const elkLayouts = (await import('@mermaid-js/layout-elk')).default;
    mermaidModule.registerLayoutLoaders(elkLayouts);
  } catch (e) {
    console.warn('[Mermaid] ELK layout not available, using dagre:', e);
  }

  mermaidModule.initialize(buildMermaidConfig('dark'));
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

const ICON_FIT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>';
const ICON_CLIPBOARD = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>';

// ── Mermaid 主题 ──
const MERMAID_THEMES = ['dark', 'default', 'forest', 'neutral', 'base'] as const;
type MermaidTheme = typeof MERMAID_THEMES[number];

// ── Mermaid 图表模板 ──
const MERMAID_TEMPLATES: { label: string; code: string }[] = [
  { label: 'Flowchart', code: 'graph TD\n  A[开始] --> B{条件}\n  B -->|是| C[操作]\n  B -->|否| D[跳过]\n  C --> E[结束]\n  D --> E' },
  { label: 'Sequence', code: 'sequenceDiagram\n  participant A as 用户\n  participant B as 服务器\n  A->>B: 请求\n  B-->>A: 响应' },
  { label: 'Class', code: 'classDiagram\n  class Animal {\n    +String name\n    +move()\n  }\n  class Dog {\n    +bark()\n  }\n  Animal <|-- Dog' },
  { label: 'State', code: 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Processing : start\n  Processing --> Done : finish\n  Done --> [*]' },
  { label: 'ER', code: 'erDiagram\n  USER ||--o{ ORDER : places\n  ORDER ||--|{ ITEM : contains\n  USER {\n    int id\n    string name\n  }' },
  { label: 'Gantt', code: 'gantt\n  title 项目计划\n  dateFormat YYYY-MM-DD\n  section 阶段一\n  任务A :a1, 2024-01-01, 7d\n  任务B :after a1, 5d\n  section 阶段二\n  任务C :2024-01-15, 10d' },
  { label: 'Pie', code: 'pie title 分布\n  "A" : 40\n  "B" : 30\n  "C" : 20\n  "D" : 10' },
  { label: 'Mindmap', code: 'mindmap\n  root((主题))\n    分支A\n      叶子1\n      叶子2\n    分支B\n      叶子3' },
];

// ── CodeMirror 暗色主题 ──

const cmDarkTheme = CMView.theme({
  '&': { backgroundColor: '#1e1e1e', color: '#d4d4d4', height: '100%' },
  '.cm-content': { caretColor: '#e8eaed', fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace", fontSize: '14px', lineHeight: '1.6' },
  '.cm-cursor': { borderLeftColor: '#e8eaed' },
  '.cm-gutters': { backgroundColor: '#1a1a1a', color: '#555', borderRight: '1px solid #2a2a2a' },
  '.cm-activeLineGutter': { backgroundColor: '#252525', color: '#888' },
  '.cm-activeLine': { backgroundColor: '#252525' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: '#264f78 !important' },
  '.cm-matchingBracket': { backgroundColor: '#3a3a3a', outline: '1px solid #555' },
}, { dark: true });

const cmDarkHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#569cd6' },
  { tag: tags.comment, color: '#6a9955', fontStyle: 'italic' },
  { tag: tags.string, color: '#ce9178' },
  { tag: tags.number, color: '#b5cea8' },
  { tag: tags.operator, color: '#d4d4d4', fontWeight: 'bold' },
  { tag: tags.variableName, color: '#9cdcfe' },
  { tag: tags.attributeName, color: '#dcdcaa' },
  { tag: tags.punctuation, color: '#808080' },
]);

let mermaidIdCounter = 0;
type ViewMode = 'split' | 'preview';

// ── NodeView ──

const codeBlockNodeView: NodeViewFactory = (node, view, getPos) => {
  let renderTimer: ReturnType<typeof setTimeout> | null = null;
  const LS_VIEW_KEY = 'krig-mermaid-view-mode';
  let viewMode: ViewMode = (localStorage.getItem(LS_VIEW_KEY) as ViewMode) || 'split';

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
    const svgEl = preview.querySelector('svg');
    if (!svgEl) return;
    exportSvgAsPng(svgEl, 'mermaid-diagram.png');
  });

  /** 通过系统保存对话框导出 PNG */
  function exportSvgAsPng(svgEl: SVGElement, filename: string) {
    // 克隆 SVG，设置明确的像素宽高
    const clone = svgEl.cloneNode(true) as SVGElement;
    const viewBox = svgEl.getAttribute('viewBox');
    if (viewBox) {
      const parts = viewBox.split(/\s+/).map(Number);
      const w = parts[2] || svgEl.clientWidth || 800;
      const h = parts[3] || svgEl.clientHeight || 600;
      clone.setAttribute('width', String(w));
      clone.setAttribute('height', String(h));
    } else {
      clone.setAttribute('width', String(svgEl.clientWidth || 800));
      clone.setAttribute('height', String(svgEl.clientHeight || 600));
    }

    const svgData = new XMLSerializer().serializeToString(clone);
    const dataUri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth * scale;
      canvas.height = img.naturalHeight * scale;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        saveBlobFile({ defaultName: filename, blob, filters: [{ name: 'PNG Image', extensions: ['png'] }] });
      }, 'image/png');
    };
    img.src = dataUri;
  }

  /** 通过系统保存对话框导出 SVG（添加背景色 + 居中 padding） */
  function exportSvgAsFile(svgEl: SVGElement, filename: string) {
    const clone = svgEl.cloneNode(true) as SVGElement;

    // 从 viewBox 获取尺寸，增加 padding 居中
    const vb = svgEl.getAttribute('viewBox');
    const pad = 40;
    if (vb) {
      const [vx, vy, vw, vh] = vb.split(/\s+/).map(Number);
      const newVb = `${vx - pad} ${vy - pad} ${vw + pad * 2} ${vh + pad * 2}`;
      clone.setAttribute('viewBox', newVb);
      clone.setAttribute('width', String(vw + pad * 2));
      clone.setAttribute('height', String(vh + pad * 2));
      // 插入背景矩形
      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bg.setAttribute('x', String(vx - pad));
      bg.setAttribute('y', String(vy - pad));
      bg.setAttribute('width', String(vw + pad * 2));
      bg.setAttribute('height', String(vh + pad * 2));
      bg.setAttribute('fill', '#1a1a1a');
      clone.insertBefore(bg, clone.firstChild);
    }
    // 移除 width="100%"
    if (clone.getAttribute('width') === '100%') clone.removeAttribute('width');

    const svgData = new XMLSerializer().serializeToString(clone);
    saveTextFile({ defaultName: filename, text: svgData, filters: SVG_FILTERS });
  }

  // ── 全屏编辑 ──
  btnFullscreen.addEventListener('mousedown', (e) => {
    e.preventDefault(); e.stopPropagation();
    openFullscreenEditor();
  });

  function openFullscreenEditor() {
    const LS_SPLIT = 'krig-mermaid-split-ratio';
    const LS_THEME = 'krig-mermaid-theme';
    let currentTheme: MermaidTheme = (localStorage.getItem(LS_THEME) as MermaidTheme) || 'dark';

    const overlay = document.createElement('div');
    overlay.classList.add('code-block__fullscreen-overlay');

    // ── 顶部工具栏 ──
    const fsToolbar = document.createElement('div');
    fsToolbar.classList.add('code-block__fs-toolbar');

    const fsTitle = document.createElement('span');
    fsTitle.classList.add('code-block__fs-title');
    fsTitle.textContent = 'Mermaid Editor';
    fsToolbar.appendChild(fsTitle);

    function makeSep() {
      const s = document.createElement('div');
      s.classList.add('code-block__fs-sep');
      return s;
    }
    function makeBtn(icon: string, title: string): HTMLButtonElement {
      const b = document.createElement('button');
      b.classList.add('code-block__fs-btn');
      b.innerHTML = icon;
      b.title = title;
      return b;
    }
    function makeSelect(options: string[], selected: string, title: string): HTMLSelectElement {
      const sel = document.createElement('select');
      sel.classList.add('code-block__fs-select');
      sel.title = title;
      for (const opt of options) {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        if (opt === selected) o.selected = true;
        sel.appendChild(o);
      }
      return sel;
    }

    // 模板选择
    const templateSelect = makeSelect(
      ['Template...', ...MERMAID_TEMPLATES.map(t => t.label)],
      'Template...',
      '插入图表模板',
    );
    fsToolbar.appendChild(templateSelect);

    fsToolbar.appendChild(makeSep());

    // 主题切换
    const themeSelect = makeSelect([...MERMAID_THEMES], currentTheme, '预览主题');
    fsToolbar.appendChild(themeSelect);

    // 方向切换
    const dirSelect = makeSelect(['TB', 'LR', 'RL', 'BT'], 'TB', '流程方向');
    fsToolbar.appendChild(dirSelect);

    const fsSpacer = document.createElement('div');
    fsSpacer.style.flex = '1';
    fsToolbar.appendChild(fsSpacer);

    // 导出按钮（toggle 格式）
    let downloadFormat: 'PNG' | 'SVG' = 'PNG';
    let copyFormat: 'PNG' | 'SVG' = 'PNG';

    function makeToggleBtn(icon: string, getLabel: () => string, title: string): HTMLButtonElement {
      const btn = document.createElement('button');
      btn.classList.add('code-block__fs-btn', 'code-block__fs-btn--labeled');
      btn.title = title;
      btn.innerHTML = `${icon}<span class="code-block__fs-btn-label">${getLabel()}</span>`;
      return btn;
    }
    function updateBtnLabel(btn: HTMLButtonElement, icon: string, label: string) {
      btn.innerHTML = `${icon}<span class="code-block__fs-btn-label">${label}</span>`;
    }

    const btnDownload = makeToggleBtn(ICON_DOWNLOAD, () => downloadFormat, '下载（点击标签切换格式）');
    const btnCopy = makeToggleBtn(ICON_CLIPBOARD, () => copyFormat, '复制（点击标签切换格式）');
    const btnFit = makeBtn(ICON_FIT, '适应屏幕');

    // 点击标签切换格式
    btnDownload.addEventListener('click', (e) => {
      const label = (e.target as HTMLElement).closest('.code-block__fs-btn-label');
      if (label) {
        e.stopPropagation();
        downloadFormat = downloadFormat === 'PNG' ? 'SVG' : 'PNG';
        updateBtnLabel(btnDownload, ICON_DOWNLOAD, downloadFormat);
        return;
      }
    });
    btnCopy.addEventListener('click', (e) => {
      const label = (e.target as HTMLElement).closest('.code-block__fs-btn-label');
      if (label) {
        e.stopPropagation();
        copyFormat = copyFormat === 'PNG' ? 'SVG' : 'PNG';
        updateBtnLabel(btnCopy, ICON_CLIPBOARD, copyFormat);
        return;
      }
    });

    fsToolbar.appendChild(btnDownload);
    fsToolbar.appendChild(btnCopy);
    fsToolbar.appendChild(makeSep());
    fsToolbar.appendChild(btnFit);
    // zoomBar 在下方创建后插入此处
    fsToolbar.appendChild(makeSep());

    // 关闭按钮
    const btnClose = makeBtn('&times;', '关闭 (Esc)');
    btnClose.style.fontSize = '20px';
    fsToolbar.appendChild(btnClose);

    overlay.appendChild(fsToolbar);

    // ── 编辑区（左右分屏） ──
    const editorArea = document.createElement('div');
    editorArea.classList.add('code-block__fs-editor');

    // 左：行号 + 代码编辑
    const editorPane = document.createElement('div');
    editorPane.classList.add('code-block__fs-code');

    // CodeMirror 编辑器
    const cmContainer = document.createElement('div');
    cmContainer.classList.add('code-block__fs-cm');
    editorPane.appendChild(cmContainer);
    editorArea.appendChild(editorPane);

    const cmState = CMState.create({
      doc: code.textContent || '',
      extensions: [
        lineNumbers(),
        cmDarkTheme,
        syntaxHighlighting(cmDarkHighlight),
        mermaidLanguage,
        cmKeymap.of([...defaultKeymap, indentWithTab]),
        CMView.updateListener.of((update) => {
          if (update.docChanged) scheduleFsRender();
        }),
      ],
    });
    const cmEditor = new CMView({ state: cmState, parent: cmContainer });

    // 获取编辑器内容的辅助函数
    function getEditorContent(): string { return cmEditor.state.doc.toString(); }
    function setEditorContent(text: string) {
      cmEditor.dispatch({ changes: { from: 0, to: cmEditor.state.doc.length, insert: text } });
    }

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

    // 底部状态栏（错误信息）
    const statusBar = document.createElement('div');
    statusBar.classList.add('code-block__fs-status');

    overlay.appendChild(editorArea);
    overlay.appendChild(statusBar);
    document.body.appendChild(overlay);

    // ── 分隔线拖拽 ──
    let splitRatio = parseFloat(localStorage.getItem(LS_SPLIT) || '0.5');
    function applySplitRatio(ratio: number) {
      splitRatio = ratio;
      editorPane.style.flex = 'none';
      editorPane.style.width = `${ratio * 100}%`;
      previewPane.style.flex = 'none';
      previewPane.style.width = `${(1 - ratio) * 100}%`;
    }
    applySplitRatio(splitRatio);

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
      const ratio = Math.max(0.15, Math.min(0.85, (e.clientX - rect.left) / rect.width));
      applySplitRatio(ratio);
    };
    const onDividerUp = () => {
      if (!dividerDragging) return;
      dividerDragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem(LS_SPLIT, splitRatio.toString());
    };
    document.addEventListener('mousemove', onDividerMove);
    document.addEventListener('mouseup', onDividerUp);

    // ── 预览渲染 ──
    let fsRenderTimer: ReturnType<typeof setTimeout> | null = null;
    let fsIdCounter = 0;

    async function renderFsPreview(source: string) {
      const trimmed = source.replace(/[\u200B\u200C\u200D\uFEFF]/g, '').trim();
      if (!trimmed) {
        previewWrapper.innerHTML = '<div class="code-block__mermaid-empty">输入 Mermaid 语法查看预览</div>';
        statusBar.textContent = '';
        statusBar.className = 'code-block__fs-status';
        return;
      }
      await ensureMermaidInit();

      // 应用主题
      mermaidModule.initialize(buildMermaidConfig(currentTheme));

      const renderId = `fs-mermaid-${++fsIdCounter}`;
      try {
        const { svg } = await mermaidModule.render(renderId, trimmed);
        previewWrapper.innerHTML = svg;
        statusBar.textContent = '✓ 渲染成功';
        statusBar.className = 'code-block__fs-status code-block__fs-status--ok';
      } catch (err: any) {
        // 解析错误信息
        const msg = err?.message || err?.toString() || 'Mermaid 语法错误';
        // 尝试提取行号
        const lineMatch = msg.match(/line\s+(\d+)/i) || msg.match(/at position.*?line:\s*(\d+)/i);
        const lineInfo = lineMatch ? ` (第 ${lineMatch[1]} 行)` : '';
        // 截取关键错误信息（去掉冗长的堆栈）
        const shortMsg = msg.split('\n')[0].slice(0, 200);
        statusBar.textContent = `✗ ${shortMsg}${lineInfo}`;
        statusBar.className = 'code-block__fs-status code-block__fs-status--error';
        previewWrapper.innerHTML = '<div class="code-block__mermaid-error">语法错误 — 查看底部状态栏</div>';
        document.getElementById('d' + renderId)?.remove();
      }
    }

    function scheduleFsRender() {
      if (fsRenderTimer) clearTimeout(fsRenderTimer);
      fsRenderTimer = setTimeout(() => renderFsPreview(getEditorContent()), 300);
    }

    // 初始渲染
    renderFsPreview(getEditorContent());

    // ── 模板选择 ──
    templateSelect.addEventListener('change', () => {
      const tpl = MERMAID_TEMPLATES.find(t => t.label === templateSelect.value);
      if (tpl) {
        setEditorContent(tpl.code);
        scheduleFsRender();
      }
      templateSelect.value = 'Template...';
    });

    // ── 主题切换 ──
    themeSelect.addEventListener('change', () => {
      currentTheme = themeSelect.value as MermaidTheme;
      localStorage.setItem(LS_THEME, currentTheme);
      scheduleFsRender();
    });

    // ── 方向切换 ──
    dirSelect.addEventListener('change', () => {
      const dir = dirSelect.value;
      const val = getEditorContent();
      // 替换 graph/flowchart 后的方向标识
      const replaced = val.replace(/^(graph|flowchart)\s+(TD|TB|LR|RL|BT)/m, `$1 ${dir}`);
      if (replaced !== val) {
        setEditorContent(replaced);
        scheduleFsRender();
      }
    });

    // ── 缩放控制条（toolbar 内，适应屏幕按钮之后） ──
    const zoomBar = document.createElement('div');
    zoomBar.classList.add('code-block__fs-zoom');

    const zoomOut = document.createElement('button');
    zoomOut.classList.add('code-block__fs-zoom-btn');
    zoomOut.textContent = '−';
    zoomOut.title = '缩小';

    const zoomLabel = document.createElement('span');
    zoomLabel.classList.add('code-block__fs-zoom-label');
    zoomLabel.textContent = '100%';

    const zoomInput = document.createElement('input');
    zoomInput.classList.add('code-block__fs-zoom-input');
    zoomInput.type = 'text';
    zoomInput.style.display = 'none';

    const zoomIn = document.createElement('button');
    zoomIn.classList.add('code-block__fs-zoom-btn');
    zoomIn.textContent = '+';
    zoomIn.title = '放大';

    zoomBar.appendChild(zoomOut);
    zoomBar.appendChild(zoomLabel);
    zoomBar.appendChild(zoomInput);
    zoomBar.appendChild(zoomIn);

    // 插入到 toolbar：适应屏幕按钮后面
    btnFit.after(zoomBar);

    // ── 预览区缩放（仅通过 toolbar 控制，原生滚动条浏览） ──
    let scale = 1;
    function updateZoomLabel() {
      zoomLabel.textContent = `${Math.round(scale * 100)}%`;
    }
    function applyScale() {
      previewWrapper.style.transform = `scale(${scale})`;
      updateZoomLabel();
    }

    zoomOut.addEventListener('click', () => {
      scale = Math.max(0.1, scale - 0.1);
      applyScale();
    });
    zoomIn.addEventListener('click', () => {
      scale = Math.min(5, scale + 0.1);
      applyScale();
    });

    // 点击百分比 → 显示输入框
    zoomLabel.addEventListener('click', () => {
      zoomLabel.style.display = 'none';
      zoomInput.style.display = '';
      zoomInput.value = String(Math.round(scale * 100));
      zoomInput.focus();
      zoomInput.select();
    });
    function commitZoomInput() {
      const val = parseInt(zoomInput.value, 10);
      if (!isNaN(val) && val > 0) {
        scale = Math.max(0.1, Math.min(5, val / 100));
        applyScale();
      }
      zoomInput.style.display = 'none';
      zoomLabel.style.display = '';
    }
    zoomInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitZoomInput(); }
      if (e.key === 'Escape') { e.preventDefault(); zoomInput.style.display = 'none'; zoomLabel.style.display = ''; }
      e.stopPropagation();
    });
    zoomInput.addEventListener('blur', commitZoomInput);

    // ── 适应屏幕 ──
    btnFit.addEventListener('click', () => {
      scale = 1;
      applyScale();
      previewPane.scrollTop = 0;
      previewPane.scrollLeft = 0;
    });

    // ── 导出 ──
    function getSvgEl(): SVGElement | null { return previewWrapper.querySelector('svg'); }

    // 下载（根据当前 toggle 格式）
    btnDownload.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.code-block__fs-btn-label')) return;
      const svgEl = getSvgEl();
      if (!svgEl) return;
      if (downloadFormat === 'PNG') {
        exportSvgAsPng(svgEl, 'mermaid-diagram.png');
      } else {
        exportSvgAsFile(svgEl, 'mermaid-diagram.svg');
      }
    });

    // 复制（根据当前 toggle 格式）
    btnCopy.addEventListener('click', async (e) => {
      if ((e.target as HTMLElement).closest('.code-block__fs-btn-label')) return;
      const svgEl = getSvgEl();
      if (!svgEl) return;
      const svgData = new XMLSerializer().serializeToString(svgEl);

      if (copyFormat === 'SVG') {
        try {
          await navigator.clipboard.writeText(svgData);
          btnCopy.classList.add('code-block__fs-btn--ok');
          setTimeout(() => btnCopy.classList.remove('code-block__fs-btn--ok'), 1500);
        } catch { /* fallback */ }
      } else {
        // 克隆 SVG 设置明确宽高，避免 naturalWidth 不准
        const clone = svgEl.cloneNode(true) as SVGElement;
        const vb = svgEl.getAttribute('viewBox');
        if (vb) {
          const p = vb.split(/\s+/).map(Number);
          clone.setAttribute('width', String(p[2] || 800));
          clone.setAttribute('height', String(p[3] || 600));
        }
        const cloneData = new XMLSerializer().serializeToString(clone);
        const dataUri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(cloneData)));
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth * 2;
          canvas.height = img.naturalHeight * 2;
          const ctx = canvas.getContext('2d')!;
          ctx.scale(2, 2);
          ctx.drawImage(img, 0, 0);
          canvas.toBlob(async (b) => {
            if (!b) return;
            try {
              await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]);
              btnCopy.classList.add('code-block__fs-btn--ok');
              setTimeout(() => btnCopy.classList.remove('code-block__fs-btn--ok'), 1500);
            } catch { /* clipboard API may fail */ }
          }, 'image/png');
        };
        img.src = dataUri;
      }
    });

    // ── 关闭 → 同步内容回 ProseMirror ──
    const close = () => {
      // 恢复 mermaid 配置为 dark（inline 预览用 dark）
      if (currentTheme !== 'dark') {
        mermaidModule?.initialize?.(buildMermaidConfig('dark'));
      }
      const newContent = getEditorContent();
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos != null) {
        const currentNode = view.state.doc.nodeAt(pos);
        if (currentNode && currentNode.textContent !== newContent) {
          const tr = view.state.tr;
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
      cmEditor.destroy();
      overlay.remove();
      document.removeEventListener('mousemove', onDividerMove);
      document.removeEventListener('mouseup', onDividerUp);
      document.removeEventListener('keydown', onKey);
      if (fsRenderTimer) clearTimeout(fsRenderTimer);
      view.focus();
    };

    btnClose.addEventListener('click', close);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);

    setTimeout(() => cmEditor.focus(), 50);
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
    updateViewMode(viewMode);
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
        if (langChanged) { updateViewMode(viewMode); renderMermaid(node.textContent); openMermaidPanel(); }
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
