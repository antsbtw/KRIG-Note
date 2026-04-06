/**
 * latex-panel — LaTeX 公式参考面板
 *
 * 基于 Help Panel 框架，显示按分类组织的数学公式模板。
 * 点击公式 → 展开 LaTeX 源码 → 点击 Insert 插入到活跃的 mathBlock。
 *
 * 公共 API：showMathPanel / hideMathPanel
 */

import katex from 'katex';
import { createHelpPanel, showHelpPanel, hideHelpPanel } from '../help-panel-core';
import type { HelpPanelShell } from '../help-panel-types';
import { MATH_CATEGORIES } from './latex-data';

let shell: HelpPanelShell | null = null;
let contentBuilt = false;
let currentInsertFn: ((latex: string) => void) | null = null;

const PANEL_ID = 'latex';

/**
 * 显示 LaTeX 公式参考面板。
 * @param insertFn — 将 LaTeX 插入活跃 mathBlock 的回调
 */
export function showMathPanel(insertFn: (latex: string) => void): void {
  currentInsertFn = insertFn;

  if (!shell) {
    shell = createHelpPanel({
      id: PANEL_ID,
      title: 'Formula Reference',
      excludeFromClickOutside: ['.math-block-wrapper', '.math-inline-editor'],
    });
  }

  if (!contentBuilt) {
    buildContent(shell);
    contentBuilt = true;
  }

  showHelpPanel(PANEL_ID);
}

/** 隐藏 LaTeX 公式参考面板。 */
export function hideMathPanel(): void {
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

  let activeCategory = MATH_CATEGORIES[0].id;

  function showCategory(catId: string) {
    activeCategory = catId;
    tabs.querySelectorAll('.help-panel__tab').forEach((tab) => {
      tab.classList.toggle('help-panel__tab--active', tab.getAttribute('data-cat') === catId);
    });
    content.querySelectorAll('.help-panel__cat-panel').forEach((panel) => {
      (panel as HTMLElement).style.display = panel.getAttribute('data-cat') === catId ? 'block' : 'none';
    });
  }

  MATH_CATEGORIES.forEach((cat) => {
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
      item.classList.add('help-panel__item');

      // 渲染预览（始终可见）
      const preview = document.createElement('div');
      preview.classList.add('help-panel__preview');
      try {
        preview.innerHTML = katex.renderToString(tmpl.label, {
          throwOnError: false,
          displayMode: false,
          output: 'html',
        });
      } catch {
        preview.textContent = tmpl.label;
      }
      item.appendChild(preview);

      // 详情行：LaTeX 源码 + Insert 按钮（点击展开）
      const detail = document.createElement('div');
      detail.classList.add('help-panel__detail');
      detail.style.display = 'none';

      const codeEl = document.createElement('code');
      codeEl.classList.add('help-panel__code');
      codeEl.textContent = tmpl.latex.trim();
      detail.appendChild(codeEl);

      const insertBtn = document.createElement('button');
      insertBtn.classList.add('help-panel__action-btn');
      insertBtn.textContent = 'Insert';
      insertBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (currentInsertFn) {
          currentInsertFn(tmpl.latex);
        }
      });
      detail.appendChild(insertBtn);

      item.appendChild(detail);

      // 点击预览区切换详情显示
      preview.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isVisible = detail.style.display !== 'none';
        detail.style.display = isVisible ? 'none' : 'flex';
        item.classList.toggle('help-panel__item--expanded', !isVisible);
      });

      panel.appendChild(item);
    });

    content.appendChild(panel);
  });
}
