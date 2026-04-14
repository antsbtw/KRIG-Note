/**
 * math-visual-panel — 函数图形参考面板
 *
 * 基于 Help Panel 框架，按分类展示常用函数模板。
 * 点击模板 → 展开表达式 → 点击 Insert 插入到函数输入框。
 *
 * 公共 API：showMathVisualPanel / hideMathVisualPanel
 */

import katex from 'katex';
import { createHelpPanel, showHelpPanel, hideHelpPanel } from '../help-panel-core';
import type { HelpPanelShell } from '../help-panel-types';
import { MATH_VISUAL_CATEGORIES } from './math-visual-data';

let shell: HelpPanelShell | null = null;
let contentBuilt = false;
let currentInsertFn: ((expr: string) => void) | null = null;

const PANEL_ID = 'math-visual';

/**
 * 显示函数图形参考面板。
 * @param insertFn — 将表达式插入函数输入框的回调
 */
export function showMathVisualPanel(insertFn: (expr: string) => void): void {
  currentInsertFn = insertFn;

  if (!shell) {
    shell = createHelpPanel({
      id: PANEL_ID,
      title: 'Function Reference',
      excludeFromClickOutside: ['.math-visual-block', '.mv-fullscreen-overlay'],
    });
  }

  if (!contentBuilt) {
    buildContent(shell);
    contentBuilt = true;
  }

  showHelpPanel(PANEL_ID);
}

/** 隐藏函数图形参考面板。 */
export function hideMathVisualPanel(): void {
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

  let activeCategory = MATH_VISUAL_CATEGORIES[0].id;

  function showCategory(catId: string) {
    activeCategory = catId;
    tabs.querySelectorAll('.help-panel__tab').forEach((tab) => {
      tab.classList.toggle('help-panel__tab--active', tab.getAttribute('data-cat') === catId);
    });
    content.querySelectorAll('.help-panel__cat-panel').forEach((panel) => {
      (panel as HTMLElement).style.display = panel.getAttribute('data-cat') === catId ? 'block' : 'none';
    });
  }

  MATH_VISUAL_CATEGORIES.forEach((cat) => {
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

      // ── 预览区（始终可见）──
      const preview = document.createElement('div');
      preview.classList.add('help-panel__preview');

      // 标题 + 描述
      const titleEl = document.createElement('span');
      titleEl.classList.add('help-panel__preview-title');
      titleEl.textContent = tmpl.label;
      preview.appendChild(titleEl);

      // KaTeX 渲染的公式预览
      if (tmpl.preview) {
        const formulaEl = document.createElement('span');
        formulaEl.classList.add('help-panel__preview-formula');
        try {
          formulaEl.innerHTML = katex.renderToString(tmpl.preview, {
            throwOnError: false,
            displayMode: false,
            output: 'html',
          });
        } catch {
          formulaEl.textContent = tmpl.preview;
        }
        preview.appendChild(formulaEl);
      }

      item.appendChild(preview);

      // ── 详情行：描述 + 表达式 + Insert 按钮 ──
      const detail = document.createElement('div');
      detail.classList.add('help-panel__detail');
      detail.style.display = 'none';

      const descEl = document.createElement('span');
      descEl.classList.add('help-panel__detail-desc');
      descEl.textContent = tmpl.desc;
      detail.appendChild(descEl);

      if (tmpl.code) {
        const codeEl = document.createElement('code');
        codeEl.classList.add('help-panel__code');
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
      }

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
