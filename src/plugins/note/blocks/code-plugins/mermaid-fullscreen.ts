import { EditorView as CMView, lineNumbers, keymap as cmKeymap } from '@codemirror/view';
import { EditorState as CMState } from '@codemirror/state';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting } from '@codemirror/language';
import { mermaidLanguage } from '../mermaid-lang';
import { cmDarkTheme, cmDarkHighlight, ICON_DOWNLOAD, ICON_CLIPBOARD, ICON_FIT } from '../code-block';
import { saveBlobFile, saveTextFile, SVG_FILTERS } from '../../utils/save-file';
import { getMermaidModule, buildMermaidConfig, MERMAID_THEMES, MERMAID_TEMPLATES } from './mermaid-plugin';
import type { MermaidTheme } from './mermaid-plugin';
import type { CodePluginContext } from './types';

/**
 * Mermaid 全屏编辑器
 *
 * 从 code-block.ts 的 openFullscreenEditor() 迁移。
 * 提供 CodeMirror 编辑 + 实时 Mermaid 预览 + 导出。
 */

export function openMermaidFullscreen(ctx: CodePluginContext): void {
  const { view, getPos } = ctx;
  const codeText = ctx.getCode();

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

  // 导出按钮
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

  btnDownload.addEventListener('click', (e) => {
    const label = (e.target as HTMLElement).closest('.code-block__fs-btn-label');
    if (label) { e.stopPropagation(); downloadFormat = downloadFormat === 'PNG' ? 'SVG' : 'PNG'; updateBtnLabel(btnDownload, ICON_DOWNLOAD, downloadFormat); return; }
  });
  btnCopy.addEventListener('click', (e) => {
    const label = (e.target as HTMLElement).closest('.code-block__fs-btn-label');
    if (label) { e.stopPropagation(); copyFormat = copyFormat === 'PNG' ? 'SVG' : 'PNG'; updateBtnLabel(btnCopy, ICON_CLIPBOARD, copyFormat); return; }
  });

  fsToolbar.appendChild(btnDownload);
  fsToolbar.appendChild(btnCopy);
  fsToolbar.appendChild(makeSep());
  fsToolbar.appendChild(btnFit);
  fsToolbar.appendChild(makeSep());

  const btnClose = makeBtn('&times;', '关闭 (Esc)');
  btnClose.style.fontSize = '20px';
  fsToolbar.appendChild(btnClose);

  overlay.appendChild(fsToolbar);

  // ── 编辑区（左右分屏） ──
  const editorArea = document.createElement('div');
  editorArea.classList.add('code-block__fs-editor');

  const editorPane = document.createElement('div');
  editorPane.classList.add('code-block__fs-code');

  const cmContainer = document.createElement('div');
  cmContainer.classList.add('code-block__fs-cm');
  editorPane.appendChild(cmContainer);
  editorArea.appendChild(editorPane);

  const cmState = CMState.create({
    doc: codeText,
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

  function getEditorContent(): string { return cmEditor.state.doc.toString(); }
  function setEditorContent(text: string) {
    cmEditor.dispatch({ changes: { from: 0, to: cmEditor.state.doc.length, insert: text } });
  }

  // 分隔线
  const divider = document.createElement('div');
  divider.classList.add('code-block__fs-divider');
  editorArea.appendChild(divider);

  // 预览
  const previewPane = document.createElement('div');
  previewPane.classList.add('code-block__fs-preview');
  const previewWrapper = document.createElement('div');
  previewWrapper.classList.add('code-block__fs-preview-wrapper');
  previewPane.appendChild(previewWrapper);
  editorArea.appendChild(previewPane);

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
    const mm = await getMermaidModule();
    mm.initialize(buildMermaidConfig(currentTheme));

    const renderId = `fs-mermaid-${++fsIdCounter}`;
    try {
      const { svg } = await mm.render(renderId, trimmed);
      previewWrapper.innerHTML = svg;
      statusBar.textContent = '✓ 渲染成功';
      statusBar.className = 'code-block__fs-status code-block__fs-status--ok';
    } catch (err: any) {
      const msg = err?.message || err?.toString() || 'Mermaid 语法错误';
      const lineMatch = msg.match(/line\s+(\d+)/i) || msg.match(/at position.*?line:\s*(\d+)/i);
      const lineInfo = lineMatch ? ` (第 ${lineMatch[1]} 行)` : '';
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

  renderFsPreview(getEditorContent());

  // ── 模板选择 ──
  templateSelect.addEventListener('change', () => {
    const tpl = MERMAID_TEMPLATES.find(t => t.label === templateSelect.value);
    if (tpl) { setEditorContent(tpl.code); scheduleFsRender(); }
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
    const replaced = val.replace(/^(graph|flowchart)\s+(TD|TB|LR|RL|BT)/m, `$1 ${dir}`);
    if (replaced !== val) { setEditorContent(replaced); scheduleFsRender(); }
  });

  // ── 缩放 ──
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
  btnFit.after(zoomBar);

  let scale = 1;
  function updateZoomLabel() { zoomLabel.textContent = `${Math.round(scale * 100)}%`; }
  function applyScale() { previewWrapper.style.transform = `scale(${scale})`; updateZoomLabel(); }
  zoomOut.addEventListener('click', () => { scale = Math.max(0.1, scale - 0.1); applyScale(); });
  zoomIn.addEventListener('click', () => { scale = Math.min(5, scale + 0.1); applyScale(); });
  zoomLabel.addEventListener('click', () => {
    zoomLabel.style.display = 'none'; zoomInput.style.display = '';
    zoomInput.value = String(Math.round(scale * 100)); zoomInput.focus(); zoomInput.select();
  });
  function commitZoomInput() {
    const val = parseInt(zoomInput.value, 10);
    if (!isNaN(val) && val > 0) { scale = Math.max(0.1, Math.min(5, val / 100)); applyScale(); }
    zoomInput.style.display = 'none'; zoomLabel.style.display = '';
  }
  zoomInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitZoomInput(); }
    if (e.key === 'Escape') { e.preventDefault(); zoomInput.style.display = 'none'; zoomLabel.style.display = ''; }
    e.stopPropagation();
  });
  zoomInput.addEventListener('blur', commitZoomInput);
  btnFit.addEventListener('click', () => { scale = 1; applyScale(); previewPane.scrollTop = 0; previewPane.scrollLeft = 0; });

  // ── 导出 ──
  function getSvgEl(): SVGElement | null { return previewWrapper.querySelector('svg'); }

  function exportSvgAsPng(svgEl: SVGElement, filename: string) {
    const clone = svgEl.cloneNode(true) as SVGElement;
    const vb = svgEl.getAttribute('viewBox');
    if (vb) { const p = vb.split(/\s+/).map(Number); clone.setAttribute('width', String(p[2] || 800)); clone.setAttribute('height', String(p[3] || 600)); }
    const svgData = new XMLSerializer().serializeToString(clone);
    const dataUri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth * 2; canvas.height = img.naturalHeight * 2;
      const c = canvas.getContext('2d')!; c.scale(2, 2); c.drawImage(img, 0, 0);
      canvas.toBlob((b) => { if (b) saveBlobFile({ defaultName: filename, blob: b, filters: SVG_FILTERS }); }, 'image/png');
    };
    img.src = dataUri;
  }

  function exportSvgAsFile(svgEl: SVGElement, filename: string) {
    const clone = svgEl.cloneNode(true) as SVGElement;
    const rect = clone.querySelector('rect');
    if (!rect) { const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', '#1e1e1e'); clone.insertBefore(bg, clone.firstChild); }
    const svgData = new XMLSerializer().serializeToString(clone);
    saveTextFile({ defaultName: filename, text: svgData, filters: SVG_FILTERS });
  }

  btnDownload.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.code-block__fs-btn-label')) return;
    const svgEl = getSvgEl(); if (!svgEl) return;
    if (downloadFormat === 'PNG') exportSvgAsPng(svgEl, 'mermaid-diagram.png');
    else exportSvgAsFile(svgEl, 'mermaid-diagram.svg');
  });

  btnCopy.addEventListener('click', async (e) => {
    if ((e.target as HTMLElement).closest('.code-block__fs-btn-label')) return;
    const svgEl = getSvgEl(); if (!svgEl) return;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    if (copyFormat === 'SVG') {
      try { await navigator.clipboard.writeText(svgData); btnCopy.classList.add('code-block__fs-btn--ok'); setTimeout(() => btnCopy.classList.remove('code-block__fs-btn--ok'), 1500); } catch {}
    } else {
      const clone = svgEl.cloneNode(true) as SVGElement;
      const vb = svgEl.getAttribute('viewBox');
      if (vb) { const p = vb.split(/\s+/).map(Number); clone.setAttribute('width', String(p[2] || 800)); clone.setAttribute('height', String(p[3] || 600)); }
      const cloneData = new XMLSerializer().serializeToString(clone);
      const dataUri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(cloneData)));
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth * 2; canvas.height = img.naturalHeight * 2;
        const c = canvas.getContext('2d')!; c.scale(2, 2); c.drawImage(img, 0, 0);
        canvas.toBlob(async (b) => {
          if (!b) return;
          try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); btnCopy.classList.add('code-block__fs-btn--ok'); setTimeout(() => btnCopy.classList.remove('code-block__fs-btn--ok'), 1500); } catch {}
        }, 'image/png');
      };
      img.src = dataUri;
    }
  });

  // ── 关闭 ──
  const close = () => {
    if (currentTheme !== 'dark') {
      getMermaidModule().then(mm => mm?.initialize?.(buildMermaidConfig('dark')));
    }
    const newContent = getEditorContent();
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos != null) {
      const currentNode = view.state.doc.nodeAt(pos);
      if (currentNode && currentNode.textContent !== newContent) {
        const tr = view.state.tr;
        const start = pos + 1;
        const end = pos + currentNode.nodeSize - 1;
        if (newContent) tr.replaceWith(start, end, view.state.schema.text(newContent));
        else tr.delete(start, end);
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
  const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  setTimeout(() => cmEditor.focus(), 50);
}
