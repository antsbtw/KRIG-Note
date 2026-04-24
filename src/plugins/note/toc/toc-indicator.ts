/**
 * toc-indicator — 目录侧边面板
 *
 * 左侧有一条窄 hover 触发区；鼠标进入 → 从左侧滑出全量目录面板。
 * 目录顶部有 h1/h2/h3/📖 四个按钮控制正文展开级别，主体是可滚动的 heading 列表。
 *
 * 数据源：从全量 atoms 扫 H1~H3（不依赖 view 分片加载进度，一次性完整展示）。
 * 点击 heading：展开必要的折叠节点并滚动到该位置。
 * 活跃高亮：IntersectionObserver 跟踪用户当前阅读位置（只能观察已加载部分）。
 */

import type { EditorView } from 'prosemirror-view';
import { Selection } from 'prosemirror-state';
import { ensureHeadingVisible, expandToLevel, getCurrentExpandLevel } from '../plugins/heading-collapse';
import type { Atom, HeadingContent, InlineElement } from '../../../shared/types/atom-types';
import './toc.css';

// ─── Types ────────────────────────────────────────────────

interface TocEntry {
  level: 1 | 2 | 3;
  text: string;
  /** 顶层 atom 索引（第 N 个不带 parentId 的 atom），跟 doc 顶层 block 索引对齐 */
  atomIndex: number;
}

interface TocIndicator {
  update(): void;
  destroy(): void;
}

// ─── 扫描：从 atoms ────────────────────────────────────────

function inlineToText(children: InlineElement[] | undefined): string {
  if (!children) return '';
  let out = '';
  for (const n of children) {
    if (n.type === 'text') out += n.text;
    else if (n.type === 'math-inline') out += `$${n.latex}$`;
    else if (n.type === 'code-inline') out += n.code;
    else if (n.type === 'link' || n.type === 'note-link') {
      const c = 'children' in n ? n.children : undefined;
      if (c) out += inlineToText(c as InlineElement[]);
      else if ('title' in n && n.title) out += n.title;
    }
  }
  return out;
}

function scanHeadingsFromAtoms(atoms: Atom[]): TocEntry[] {
  const result: TocEntry[] = [];
  let topIndex = 0;
  for (const atom of atoms) {
    if (atom.parentId) continue;
    if (atom.type === 'heading') {
      const c = atom.content as HeadingContent;
      if (c.level >= 1 && c.level <= 3) {
        result.push({
          level: c.level as 1 | 2 | 3,
          text: inlineToText(c.children) || `Heading ${c.level}`,
          atomIndex: topIndex,
        });
      }
    }
    topIndex++;
  }
  return result;
}

// ─── Public API ───────────────────────────────────────────

/**
 * 创建 TOC 侧边面板。
 *
 * @param editorContainer  NoteEditor 外层 .editor div
 * @param view             ProseMirror EditorView
 * @param getAtoms         拿全量 atoms（含未加载尾部）—— TOC 的唯一数据源
 */
export function createTocIndicator(
  editorContainer: HTMLElement,
  view: EditorView,
  getAtoms: () => Atom[],
): TocIndicator {
  let entries: TocEntry[] = [];
  let activeIndex = -1;
  let observer: IntersectionObserver | null = null;
  let isPanelVisible = false;

  // ── DOM：hover 触发区 + 浮层面板 ──
  const hotzoneEl = document.createElement('div');
  hotzoneEl.classList.add('toc-hotzone');
  document.body.appendChild(hotzoneEl);

  const panelEl = document.createElement('div');
  panelEl.classList.add('toc-panel');
  document.body.appendChild(panelEl);

  // ── 渲染面板内容 ──
  function renderPanel() {
    panelEl.innerHTML = '';

    // 顶部：展开级别按钮
    const levelBar = document.createElement('div');
    levelBar.classList.add('toc-panel__levels');
    const currentLevel = getCurrentExpandLevel(view);
    const levels: { label: string; value: number; title: string }[] = [
      { label: 'h1', value: 1, title: '只展开到 H1' },
      { label: 'h2', value: 2, title: '展开到 H2' },
      { label: 'h3', value: 3, title: '展开到 H3' },
      { label: '📖', value: Infinity, title: '全部展开' },
    ];
    for (const lv of levels) {
      const btn = document.createElement('button');
      btn.classList.add('toc-panel__level-btn');
      btn.textContent = lv.label;
      btn.title = lv.title;
      if (currentLevel === lv.value) {
        btn.classList.add('toc-panel__level-btn--active');
      }
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        expandToLevel(view, lv.value);
        // 保持面板打开，但重新渲染以更新 active 状态
        renderPanel();
      });
      levelBar.appendChild(btn);
    }
    panelEl.appendChild(levelBar);

    // 主体：heading 列表（可滚动）
    const listEl = document.createElement('div');
    listEl.classList.add('toc-panel__list');

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.classList.add('toc-panel__empty');
      empty.textContent = '暂无目录';
      listEl.appendChild(empty);
    } else {
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const btn = document.createElement('button');
        btn.classList.add('toc-panel__item');
        btn.setAttribute('data-level', String(entry.level));
        btn.textContent = entry.text;
        if (i === activeIndex) btn.classList.add('toc-panel__item--active');
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          scrollToHeading(i);
        });
        listEl.appendChild(btn);
      }
    }

    panelEl.appendChild(listEl);
  }

  // ── IntersectionObserver：跟踪当前可见 heading ──
  const tocIdxMap = new WeakMap<Element, number>();

  function setupObserver() {
    if (observer) observer.disconnect();

    const scrollContainer = editorContainer.closest('[style*="overflow"]')
      || editorContainer.parentElement;
    if (!scrollContainer) return;

    observer = new IntersectionObserver(
      (ioEntries) => {
        let bestIdx = -1;
        let bestTop = Infinity;
        for (const ioEntry of ioEntries) {
          if (!ioEntry.isIntersecting) continue;
          const idx = tocIdxMap.get(ioEntry.target) ?? -1;
          if (idx >= 0 && ioEntry.boundingClientRect.top < bestTop) {
            bestTop = ioEntry.boundingClientRect.top;
            bestIdx = idx;
          }
        }
        if (bestIdx >= 0 && bestIdx !== activeIndex) {
          activeIndex = bestIdx;
          if (isPanelVisible) {
            // 仅更新 active 样式，不重建
            panelEl.querySelectorAll('.toc-panel__item').forEach((el, i) => {
              el.classList.toggle('toc-panel__item--active', i === activeIndex);
            });
          }
        }
      },
      {
        root: scrollContainer as Element,
        rootMargin: '0px 0px -70% 0px',
        threshold: 0,
      },
    );

    observeHeadings();
  }

  /** atomIndex → doc 内部 pos；索引超出已加载范围时返回 null */
  function atomIndexToDocPos(atomIndex: number): number | null {
    const doc = view.state.doc;
    if (atomIndex < 0 || atomIndex >= doc.childCount) return null;
    let pos = 0;
    for (let i = 0; i < atomIndex; i++) pos += doc.child(i).nodeSize;
    return pos;
  }

  function observeHeadings() {
    if (!observer) return;
    observer.disconnect();
    for (let i = 0; i < entries.length; i++) {
      const docPos = atomIndexToDocPos(entries[i].atomIndex);
      if (docPos === null) continue;
      try {
        const domPos = view.domAtPos(docPos + 1);
        const el = domPos.node instanceof HTMLElement
          ? domPos.node
          : domPos.node.parentElement;
        const blockEl = el?.closest('h1, h2, h3') as HTMLElement | null;
        if (blockEl) {
          tocIdxMap.set(blockEl, i);
          observer.observe(blockEl);
        }
      } catch { /* skip */ }
    }
  }

  // ── 跳转 ──
  function scrollToHeading(index: number) {
    const entry = entries[index];
    if (!entry) return;
    const docPos = atomIndexToDocPos(entry.atomIndex);
    if (docPos === null) {
      // 目标还未加载进 view —— 先不处理（后续可扩展 ensureLoaded）
      return;
    }
    ensureHeadingVisible(view, docPos);
    requestAnimationFrame(() => {
      try {
        const domPos = view.domAtPos(docPos + 1);
        const el = domPos.node instanceof HTMLElement
          ? domPos.node
          : domPos.node.parentElement;
        const blockEl = el?.closest('h1, h2, h3') as HTMLElement | null;
        if (blockEl) blockEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const tr = view.state.tr.setSelection(
          Selection.near(view.state.doc.resolve(docPos + 1)),
        );
        view.dispatch(tr);
      } catch {
        const tr = view.state.tr.setSelection(
          Selection.near(view.state.doc.resolve(docPos + 1)),
        );
        tr.scrollIntoView();
        view.dispatch(tr);
      }
    });
  }

  // ── 面板显示 / 隐藏 ──
  function showPanel() {
    if (isPanelVisible) return;
    isPanelVisible = true;
    renderPanel();
    panelEl.classList.add('toc-panel--visible');
  }

  function hidePanel() {
    if (!isPanelVisible) return;
    isPanelVisible = false;
    panelEl.classList.remove('toc-panel--visible');
  }

  // ── Hover 事件 ──
  let leaveTimer: ReturnType<typeof setTimeout> | null = null;
  function clearLeaveTimer() {
    if (leaveTimer) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
  }
  function scheduleHide() {
    clearLeaveTimer();
    leaveTimer = setTimeout(() => {
      if (!hotzoneEl.matches(':hover') && !panelEl.matches(':hover')) {
        hidePanel();
      }
    }, 200);
  }

  hotzoneEl.addEventListener('mouseenter', () => {
    clearLeaveTimer();
    showPanel();
  });
  hotzoneEl.addEventListener('mouseleave', scheduleHide);
  panelEl.addEventListener('mouseenter', clearLeaveTimer);
  panelEl.addEventListener('mouseleave', scheduleHide);

  // ── update：重新扫描 heading（防抖 + composing 跳过）──
  let updateTimer: ReturnType<typeof setTimeout> | null = null;
  function update() {
    if (updateTimer) clearTimeout(updateTimer);
    updateTimer = setTimeout(() => {
      if (view.composing) return;
      const newEntries = scanHeadingsFromAtoms(getAtoms());
      const changed = newEntries.length !== entries.length ||
        newEntries.some((e, i) =>
          e.atomIndex !== entries[i].atomIndex ||
          e.level !== entries[i].level ||
          e.text !== entries[i].text,
        );
      if (!changed) return;
      entries = newEntries;
      if (activeIndex >= entries.length) activeIndex = entries.length - 1;
      setupObserver();
      if (isPanelVisible) renderPanel();
    }, 300);
  }

  // ── destroy ──
  function destroy() {
    if (updateTimer) clearTimeout(updateTimer);
    if (observer) observer.disconnect();
    hotzoneEl.remove();
    panelEl.remove();
  }

  // ── 初始化 ──
  requestAnimationFrame(() => update());

  return { update, destroy };
}
