/**
 * help-panel-core — 通用面板 Shell、互斥、关闭行为
 *
 * 每个 Help Panel（LaTeX、Mermaid、Dictionary …）使用此 core 获得：
 *   1. fixed 定位的面板 Shell（header + close 按钮 + body）
 *   2. 自动互斥（同一时刻只有一个面板可见）
 *   3. 统一关闭行为（× 按钮、Esc、点击外部）
 *
 * 面板模块负责填充 shell.bodyEl 的内容。
 * Tab 系统、渲染逻辑、领域数据留在各面板自己的模块中。
 *
 * 设计规范: docs/help/Help-Panel-Design-Spec.md
 */

import type { HelpPanelConfig, HelpPanelShell } from './help-panel-types';
import './help-panel.css';

// ─── Module-level state ────────────────────────────────────

/** 已缓存的面板 Shell，按 id 索引。跨 show/hide 周期复用。 */
const panelCache = new Map<string, HelpPanelShell>();

/**
 * 外部管理的面板，参与互斥但自建 DOM（如 Dictionary）。
 */
const externalPanels = new Map<string, { hideFn: () => void }>();

/** 当前可见面板 id（null 表示无） */
let activePanelId: string | null = null;

/** 全局监听器是否已安装 */
let listenersInstalled = false;

// ─── Public API ────────────────────────────────────────────

/**
 * 创建 Help Panel Shell（或返回缓存的）。
 * 不会显示面板 — 调用 shell.show() 或 showHelpPanel(id) 来显示。
 */
export function createHelpPanel(config: HelpPanelConfig): HelpPanelShell {
  const cached = panelCache.get(config.id);
  if (cached) return cached;

  installGlobalListeners();

  // ── 构建 DOM ──
  const el = document.createElement('div');
  el.classList.add('help-panel');
  el.setAttribute('data-panel-id', config.id);
  el.style.display = 'none';

  // Header
  const headerEl = document.createElement('div');
  headerEl.classList.add('help-panel__header');

  const titleEl = document.createElement('span');
  titleEl.classList.add('help-panel__title');
  titleEl.textContent = config.title;
  headerEl.appendChild(titleEl);

  const closeBtn = document.createElement('button');
  closeBtn.classList.add('help-panel__close-btn');
  closeBtn.textContent = '\u00d7'; // ×
  closeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    hideHelpPanel(config.id);
  });
  headerEl.appendChild(closeBtn);

  el.appendChild(headerEl);

  // Body（空容器，面板模块填充）
  const bodyEl = document.createElement('div');
  bodyEl.classList.add('help-panel__body');
  el.appendChild(bodyEl);

  document.body.appendChild(el);

  // ── 构建 Shell 对象 ──
  const shell: HelpPanelShell = {
    el,
    headerEl,
    bodyEl,
    show() {
      showHelpPanel(config.id);
    },
    hide() {
      hideHelpPanel(config.id);
    },
    destroy() {
      hideHelpPanel(config.id);
      el.remove();
      panelCache.delete(config.id);
    },
  };

  // 将 config 存在元素上，用于 click-outside 排除判断
  (el as any).__helpPanelConfig = config;

  panelCache.set(config.id, shell);
  return shell;
}

/**
 * 注册外部管理的面板，仅参与互斥。
 * 面板自建 DOM（如 Dictionary），但遵守"同时只有一个面板可见"的契约。
 */
export function registerExternalPanel(
  id: string,
  hideFn: () => void,
): void {
  externalPanels.set(id, { hideFn });
}

/** 注销外部面板。 */
export function unregisterExternalPanel(id: string): void {
  externalPanels.delete(id);
  if (activePanelId === id) {
    activePanelId = null;
  }
}

/**
 * 显示面板。先隐藏当前活跃面板（互斥）。
 * 对 core 管理和外部注册的面板都有效。
 */
export function showHelpPanel(id: string): void {
  if (activePanelId && activePanelId !== id) {
    hideHelpPanel(activePanelId);
  }

  const shell = panelCache.get(id);
  if (shell) {
    shell.el.style.display = 'flex';
  }

  activePanelId = id;
}

/**
 * 隐藏面板。如果不传 id，隐藏当前活跃面板。
 */
export function hideHelpPanel(id?: string): void {
  const targetId = id ?? activePanelId;
  if (!targetId) return;

  const shell = panelCache.get(targetId);
  if (shell) {
    shell.el.style.display = 'none';
  }

  const external = externalPanels.get(targetId);
  if (external) {
    external.hideFn();
  }

  if (activePanelId === targetId) {
    activePanelId = null;
  }
}

/** 返回当前可见面板的 id，或 null。 */
export function activeHelpPanelId(): string | null {
  return activePanelId;
}

/**
 * 外部面板显示时调用，通知 core 参与互斥。
 */
export function notifyExternalShow(id: string): void {
  if (activePanelId && activePanelId !== id) {
    hideHelpPanel(activePanelId);
  }
  activePanelId = id;
}

/**
 * 外部面板隐藏时调用，通知 core 清除状态。
 */
export function notifyExternalHide(id: string): void {
  if (activePanelId === id) {
    activePanelId = null;
  }
}

// ─── Global Listeners（安装一次） ─────────────────────────

function installGlobalListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;

  // Esc → 关闭活跃面板
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activePanelId) {
      const shell = panelCache.get(activePanelId);
      if (shell) {
        e.preventDefault();
        hideHelpPanel(activePanelId);
      }
    }
  });

  // 点击外部 → 关闭活跃面板
  document.addEventListener('mousedown', (e) => {
    if (!activePanelId) return;

    const shell = panelCache.get(activePanelId);
    if (!shell) return; // 外部面板自行处理 click-outside

    const target = e.target as HTMLElement;

    // 点击面板内部不关闭
    if (shell.el.contains(target)) return;

    // 点击排除区域不关闭
    const config = (shell.el as any).__helpPanelConfig as HelpPanelConfig | undefined;
    if (config?.excludeFromClickOutside) {
      for (const selector of config.excludeFromClickOutside) {
        if (target.closest(selector)) return;
      }
    }

    hideHelpPanel(activePanelId);
  });
}
