/**
 * bookmarks-panel — Note 书签面板
 *
 * 基于 help-panel-core。每次打开都会用调用方提供的 snapshot 重建内容，
 * 因为书签列表是动态的（用户可随时增删改）。
 *
 * 公共 API：showBookmarksPanel / hideBookmarksPanel
 */

import { createHelpPanel, showHelpPanel, hideHelpPanel } from '../help-panel-core';
import type { HelpPanelShell } from '../help-panel-types';

/** 书签面板外部传入的数据 + 回调 */
export interface BookmarksPanelOptions {
  /** 当前 note 的书签列表（按 block_index 排序展示） */
  bookmarks: { id: string; block_index: number; label: string }[];
  /** 顶部 "+ 当前位置" 按钮点击 */
  onAddCurrent: () => void;
  /** 用户点击书签条目 → 跳转到该 block */
  onJump: (bookmarkId: string) => void;
  /** 用户点击 × 删除 */
  onRemove: (bookmarkId: string) => void;
  /** 用户修改 label（输入框失焦/回车） */
  onRename: (bookmarkId: string, newLabel: string) => void;
}

let shell: HelpPanelShell | null = null;

const PANEL_ID = 'bookmarks';

export function showBookmarksPanel(opts: BookmarksPanelOptions): void {
  if (!shell) {
    shell = createHelpPanel({
      id: PANEL_ID,
      title: '书签',
      excludeFromClickOutside: ['.note-toolbar__bookmark-btn'],
    });
  }
  buildContent(shell, opts);
  showHelpPanel(PANEL_ID);
}

export function hideBookmarksPanel(): void {
  hideHelpPanel(PANEL_ID);
}

// ─── Content ──────────────────────────────────────────────

function buildContent(s: HelpPanelShell, opts: BookmarksPanelOptions): void {
  const body = s.bodyEl;
  body.innerHTML = '';
  body.classList.add('bookmarks-panel__body');

  // 顶部：+ 当前位置 按钮
  const addBar = document.createElement('div');
  addBar.className = 'bookmarks-panel__add-bar';
  const addBtn = document.createElement('button');
  addBtn.className = 'bookmarks-panel__add-btn';
  addBtn.textContent = '+ 添加当前位置为书签';
  addBtn.addEventListener('click', (e) => {
    e.preventDefault();
    opts.onAddCurrent();
  });
  addBar.appendChild(addBtn);
  body.appendChild(addBar);

  if (opts.bookmarks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'bookmarks-panel__empty';
    empty.textContent = '暂无书签。点击上方按钮添加当前位置。';
    body.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'bookmarks-panel__list';

  // 按 block_index 升序
  const sorted = [...opts.bookmarks].sort((a, b) => a.block_index - b.block_index);

  for (const bm of sorted) {
    const item = document.createElement('div');
    item.className = 'bookmarks-panel__item';

    // label：单击跳转，双击进入编辑（contenteditable）
    const label = document.createElement('div');
    label.className = 'bookmarks-panel__label';
    label.textContent = bm.label;
    label.title = `单击跳转到第 ${bm.block_index + 1} 个 block，双击重命名`;

    label.addEventListener('click', () => {
      // 编辑态下不触发跳转
      if (label.isContentEditable) return;
      opts.onJump(bm.id);
    });

    label.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (label.isContentEditable) return;
      label.contentEditable = 'true';
      label.classList.add('is-editing');
      label.focus();
      // 选中全部文本
      const range = document.createRange();
      range.selectNodeContents(label);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });

    const commit = () => {
      label.contentEditable = 'false';
      label.classList.remove('is-editing');
      const newLabel = (label.textContent || '').trim();
      if (newLabel && newLabel !== bm.label) {
        opts.onRename(bm.id, newLabel);
      } else {
        // 空值或无变化 → 还原
        label.textContent = bm.label;
      }
    };

    label.addEventListener('blur', () => {
      if (!label.classList.contains('is-editing')) return;
      commit();
    });

    label.addEventListener('keydown', (e) => {
      if (!label.classList.contains('is-editing')) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        label.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        label.textContent = bm.label;
        label.classList.remove('is-editing');
        label.contentEditable = 'false';
        label.blur();
      }
    });

    item.appendChild(label);

    // 删除按钮
    const rmBtn = document.createElement('button');
    rmBtn.className = 'bookmarks-panel__icon-btn bookmarks-panel__icon-btn--danger';
    rmBtn.title = '删除';
    rmBtn.innerHTML = '×';
    rmBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onRemove(bm.id);
    });
    item.appendChild(rmBtn);

    list.appendChild(item);
  }

  body.appendChild(list);
}
