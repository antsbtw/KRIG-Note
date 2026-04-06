/**
 * mermaid-panel — Mermaid 图表模板面板
 *
 * 基于 Help Panel 框架，显示按分类组织的 Mermaid 模板。
 * 点击卡片 → 展开源码 → 点击 Insert 插入到活跃的 codeBlock。
 * SVG 缩略图通过 mermaid.render() 异步渲染。
 *
 * 公共 API：showMermaidPanel / hideMermaidPanel
 */

import { createHelpPanel, showHelpPanel, hideHelpPanel } from '../help-panel-core';
import type { HelpPanelShell } from '../help-panel-types';
import { MERMAID_CATEGORIES } from './mermaid-data';

let shell: HelpPanelShell | null = null;
let contentBuilt = false;
let currentInsertFn: ((code: string) => void) | null = null;

/** 单调递增 id，避免 mermaid render id 冲突 */
let renderId = 0;

/** 延迟加载的 mermaid 模块 */
let mermaidModule: any = null;

const PANEL_ID = 'mermaid';

/**
 * 显示 Mermaid 模板面板。
 * @param insertFn — 将 Mermaid 代码插入活跃 codeBlock 的回调
 */
export function showMermaidPanel(insertFn: (code: string) => void): void {
  currentInsertFn = insertFn;

  if (!shell) {
    shell = createHelpPanel({
      id: PANEL_ID,
      title: 'Mermaid Templates',
      excludeFromClickOutside: ['.code-block'],
    });
  }

  if (!contentBuilt) {
    buildContent(shell);
    contentBuilt = true;
  }

  showHelpPanel(PANEL_ID);
}

/** 隐藏 Mermaid 模板面板。 */
export function hideMermaidPanel(): void {
  hideHelpPanel(PANEL_ID);
  currentInsertFn = null;
}

// ─── Content Building ──────────────────────────────────────

function buildContent(s: HelpPanelShell): void {
  const body = s.bodyEl;

  // Tab 栏
  const tabs = document.createElement('div');
  tabs.classList.add('help-panel__tabs');
  body.appendChild(tabs);

  // 滚动内容区
  const content = document.createElement('div');
  content.classList.add('help-panel__content');
  body.appendChild(content);

  let activeCategory = MERMAID_CATEGORIES[0].id;

  function showCategory(catId: string) {
    activeCategory = catId;
    tabs.querySelectorAll('.help-panel__tab').forEach((tab) => {
      tab.classList.toggle('help-panel__tab--active', tab.getAttribute('data-cat') === catId);
    });
    content.querySelectorAll('.help-panel__cat-panel').forEach((panel) => {
      (panel as HTMLElement).style.display = panel.getAttribute('data-cat') === catId ? 'block' : 'none';
    });
  }

  MERMAID_CATEGORIES.forEach((cat) => {
    // Tab 按钮
    const tab = document.createElement('button');
    tab.classList.add('help-panel__tab');
    if (cat.id === activeCategory) tab.classList.add('help-panel__tab--active');
    tab.setAttribute('data-cat', cat.id);
    tab.textContent = cat.name;
    tab.title = cat.name;
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showCategory(cat.id);
    });
    tabs.appendChild(tab);

    // 分类面板
    const panel = document.createElement('div');
    panel.classList.add('help-panel__cat-panel');
    panel.setAttribute('data-cat', cat.id);
    panel.style.display = cat.id === activeCategory ? 'block' : 'none';

    cat.templates.forEach((tmpl) => {
      const item = document.createElement('div');
      item.classList.add('help-panel__item', 'help-panel__item--mermaid');

      // 卡片标签
      const labelEl = document.createElement('div');
      labelEl.classList.add('help-panel__mermaid-label');
      labelEl.textContent = tmpl.label;
      item.appendChild(labelEl);

      // SVG 预览区（异步渲染）
      const previewEl = document.createElement('div');
      previewEl.classList.add('help-panel__preview', 'help-panel__mermaid-preview');
      previewEl.innerHTML = '<span class="help-panel__mermaid-loading">Rendering…</span>';
      item.appendChild(previewEl);

      // 异步渲染 SVG 缩略图
      renderPreview(tmpl.preview, previewEl);

      // 详情行：源码 + Insert 按钮（点击展开）
      const detail = document.createElement('div');
      detail.classList.add('help-panel__mermaid-detail');
      detail.style.display = 'none';

      const codeEl = document.createElement('pre');
      codeEl.classList.add('help-panel__code', 'help-panel__mermaid-code');
      codeEl.textContent = tmpl.code;
      detail.appendChild(codeEl);

      const insertBtn = document.createElement('button');
      insertBtn.classList.add('help-panel__action-btn');
      insertBtn.textContent = 'Insert';
      insertBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (currentInsertFn) {
          currentInsertFn(tmpl.code);
        }
      });
      detail.appendChild(insertBtn);

      item.appendChild(detail);

      // 点击卡片切换详情显示
      const clickToggle = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.closest('.help-panel__action-btn') || target.closest('.help-panel__mermaid-code')) return;

        e.preventDefault();
        e.stopPropagation();
        const isVisible = detail.style.display !== 'none';
        detail.style.display = isVisible ? 'none' : 'block';
        item.classList.toggle('help-panel__item--expanded', !isVisible);
      };
      labelEl.addEventListener('click', clickToggle);
      previewEl.addEventListener('click', clickToggle);

      panel.appendChild(item);
    });

    content.appendChild(panel);
  });
}

// ─── SVG Rendering ─────────────────────────────────────────

async function ensureMermaid(): Promise<any> {
  if (mermaidModule) return mermaidModule;
  mermaidModule = (await import('mermaid')).default;
  mermaidModule.initialize({
    startOnLoad: false,
    theme: 'dark',
    securityLevel: 'loose',
  });
  return mermaidModule;
}

async function renderPreview(source: string, container: HTMLElement): Promise<void> {
  try {
    const mm = await ensureMermaid();
    const id = `mermaid-help-${++renderId}`;
    const { svg } = await mm.render(id, source);
    container.innerHTML = svg;
    const svgEl = container.querySelector('svg');
    if (svgEl) {
      svgEl.style.maxWidth = '100%';
      svgEl.style.maxHeight = '140px';
      svgEl.style.height = 'auto';
    }
  } catch {
    container.innerHTML = '<span class="help-panel__mermaid-error">Preview unavailable</span>';
  }
}
