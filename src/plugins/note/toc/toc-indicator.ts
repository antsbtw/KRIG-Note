/**
 * toc-indicator — 目录导航指示器
 *
 * 左侧横线组：每条横线 = 一个 heading（H1 最长最亮，H2 中等，H3 最短最暗）
 * hover 横线区域 → 弹出目录菜单 → 点击跳转 → 菜单关闭
 * 当前可见 heading 自动高亮（IntersectionObserver）
 */

import type { EditorView } from 'prosemirror-view';
import { Selection } from 'prosemirror-state';
import { ensureHeadingVisible, expandToLevel, getCurrentExpandLevel } from '../plugins/heading-collapse';
import './toc.css';

// ─── Types ────────────────────────────────────────────────

interface TocEntry {
  level: 1 | 2 | 3;
  text: string;
  /** 节点在 doc 中的绝对位置 */
  pos: number;
}

interface TocIndicator {
  /** 文档变化时调用，重新扫描 headings */
  update(): void;
  /** 销毁 DOM + 清理监听 */
  destroy(): void;
}

// ─── Public API ───────────────────────────────────────────

/**
 * 创建 TOC 指示器，挂载到编辑器容器中。
 * @param editorContainer  NoteEditor 外层 .editor div（maxWidth: 900px 那个）
 * @param view             ProseMirror EditorView
 */
export function createTocIndicator(
  editorContainer: HTMLElement,
  view: EditorView,
): TocIndicator {
  let entries: TocEntry[] = [];
  let activeIndex = -1;
  let observer: IntersectionObserver | null = null;
  let menuEl: HTMLElement | null = null;
  let isMenuVisible = false;

  // ── 横线容器（fixed 定位，紧贴 NoteView 左边缘）──
  const indicatorEl = document.createElement('div');
  indicatorEl.classList.add('toc-indicator');
  document.body.appendChild(indicatorEl);

  // ── 扫描 headings ──
  function scanHeadings(): TocEntry[] {
    const result: TocEntry[] = [];
    const doc = view.state.doc;
    doc.forEach((node, offset) => {
      if (
        node.type.name === 'textBlock' &&
        !node.attrs.isTitle &&
        node.attrs.level &&
        node.attrs.level >= 1 &&
        node.attrs.level <= 3
      ) {
        result.push({
          level: node.attrs.level as 1 | 2 | 3,
          text: node.textContent || `Heading ${node.attrs.level}`,
          pos: offset,
        });
      }
    });
    return result;
  }

  // ── 渲染横线 ──
  function renderLines() {
    indicatorEl.innerHTML = '';

    if (entries.length === 0) {
      indicatorEl.style.display = 'none';
      return;
    }
    indicatorEl.style.display = 'flex';

    for (let i = 0; i < entries.length; i++) {
      const line = document.createElement('div');
      line.classList.add('toc-indicator__line');
      line.setAttribute('data-level', String(entries[i].level));
      if (i === activeIndex) {
        line.classList.add('toc-indicator__line--active');
      }
      indicatorEl.appendChild(line);
    }
  }

  // ── 计算指示器纵向位置（和正文第一行对齐）──
  function positionIndicator() {
    if (entries.length === 0) return;

    // 找第一个 heading 的 DOM 位置，和它水平对齐
    try {
      const firstPos = entries[0].pos + 1;
      const domPos = view.domAtPos(firstPos);
      const el = domPos.node instanceof HTMLElement
        ? domPos.node
        : domPos.node.parentElement;
      const blockEl = el?.closest('h1, h2, h3') as HTMLElement | null;
      if (blockEl) {
        const rect = blockEl.getBoundingClientRect();
        indicatorEl.style.top = `${rect.top}px`;
        return;
      }
    } catch { /* fallback below */ }

    // fallback：用 ProseMirror 区域估算
    const pmEl = editorContainer.querySelector('.ProseMirror') as HTMLElement;
    if (pmEl) {
      const titleEl = pmEl.querySelector('.note-title') as HTMLElement;
      if (titleEl) {
        indicatorEl.style.top = `${titleEl.getBoundingClientRect().bottom + 8}px`;
      } else {
        indicatorEl.style.top = `${pmEl.getBoundingClientRect().top + 24}px`;
      }
    }
  }

  // ── IntersectionObserver：跟踪当前可见 heading ──
  function setupObserver() {
    if (observer) observer.disconnect();

    const scrollContainer = editorContainer.closest('[style*="overflow"]')
      || editorContainer.parentElement;
    if (!scrollContainer) return;

    observer = new IntersectionObserver(
      (ioEntries) => {
        // 找到最靠近视口顶部的可见 heading
        let bestIdx = -1;
        let bestTop = Infinity;

        for (const ioEntry of ioEntries) {
          if (!ioEntry.isIntersecting) continue;
          const idx = parseInt(
            (ioEntry.target as HTMLElement).dataset.tocIdx || '-1',
            10,
          );
          if (idx >= 0 && ioEntry.boundingClientRect.top < bestTop) {
            bestTop = ioEntry.boundingClientRect.top;
            bestIdx = idx;
          }
        }

        if (bestIdx >= 0 && bestIdx !== activeIndex) {
          activeIndex = bestIdx;
          renderLines();
          if (isMenuVisible) renderMenu();
        }
      },
      {
        root: scrollContainer as Element,
        rootMargin: '0px 0px -70% 0px', // 上半部分视口判定
        threshold: 0,
      },
    );

    // 给每个 heading DOM 元素打上 data-toc-idx，然后 observe
    observeHeadings();
  }

  function observeHeadings() {
    if (!observer) return;
    observer.disconnect();

    for (let i = 0; i < entries.length; i++) {
      try {
        const domPos = view.domAtPos(entries[i].pos + 1); // +1 进入节点内部
        const el = domPos.node instanceof HTMLElement
          ? domPos.node
          : domPos.node.parentElement;
        // 向上找到 block 级元素（h1/h2/h3）
        const blockEl = el?.closest('h1, h2, h3') as HTMLElement | null;
        if (blockEl) {
          blockEl.dataset.tocIdx = String(i);
          observer.observe(blockEl);
        }
      } catch {
        // pos 可能无效，跳过
      }
    }
  }

  // ── 弹出菜单 ──
  function showMenu() {
    if (entries.length === 0) return;
    if (isMenuVisible) return;
    isMenuVisible = true;

    if (!menuEl) {
      menuEl = document.createElement('div');
      menuEl.classList.add('toc-menu');
      menuEl.addEventListener('mouseenter', onMenuEnter);
      menuEl.addEventListener('mouseleave', onMenuLeave);
      document.body.appendChild(menuEl);
    }

    renderMenu();
    positionMenu();
    menuEl.style.display = 'block';
  }

  function hideMenu() {
    if (!isMenuVisible) return;
    isMenuVisible = false;
    if (menuEl) menuEl.style.display = 'none';
  }

  function renderMenu() {
    if (!menuEl) return;
    menuEl.innerHTML = '';

    // 目录条目
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const btn = document.createElement('button');
      btn.classList.add('toc-menu__item');
      btn.setAttribute('data-level', String(entry.level));
      btn.textContent = entry.text;
      if (i === activeIndex) {
        btn.classList.add('toc-menu__item--active');
      }

      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        scrollToHeading(i);
        hideMenu();
      });

      menuEl.appendChild(btn);
    }

    // 展开级别按钮：1 2 3 *
    const currentLevel = getCurrentExpandLevel(view);
    const levels: { label: string; value: number }[] = [
      { label: 'h1', value: 1 },
      { label: 'h2', value: 2 },
      { label: 'h3', value: 3 },
      { label: '📖', value: Infinity },
    ];

    const levelBar = document.createElement('div');
    levelBar.classList.add('toc-menu__levels');

    for (const lv of levels) {
      const btn = document.createElement('button');
      btn.classList.add('toc-menu__level-btn');
      btn.textContent = lv.label;
      btn.title = lv.value === Infinity ? '全部展开' : `展开到 H${lv.value}`;
      if (currentLevel === lv.value) {
        btn.classList.add('toc-menu__level-btn--active');
      }
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        expandToLevel(view, lv.value);
        hideMenu();
      });
      levelBar.appendChild(btn);
    }

    menuEl.appendChild(levelBar);
  }

  function positionMenu() {
    if (!menuEl) return;
    const rect = indicatorEl.getBoundingClientRect();
    menuEl.style.left = `${rect.right + 8}px`;
    menuEl.style.top = `${rect.top}px`;

    // 确保不超出视口底部
    requestAnimationFrame(() => {
      if (!menuEl) return;
      const menuRect = menuEl.getBoundingClientRect();
      if (menuRect.bottom > window.innerHeight - 8) {
        menuEl.style.top = `${window.innerHeight - 8 - menuRect.height}px`;
      }
    });
  }

  // ── 跳转 ──
  function scrollToHeading(index: number) {
    const entry = entries[index];
    if (!entry) return;

    // 先确保目标 heading 可见（展开它自身 + 隐藏它的上级）
    ensureHeadingVisible(view, entry.pos);

    // ensureHeadingVisible 可能改变了文档，需要等 DOM 更新后再滚动
    requestAnimationFrame(() => {
      try {
        const domPos = view.domAtPos(entry.pos + 1);
        const el = domPos.node instanceof HTMLElement
          ? domPos.node
          : domPos.node.parentElement;
        const blockEl = el?.closest('h1, h2, h3') as HTMLElement | null;
        if (blockEl) {
          blockEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        const tr = view.state.tr.setSelection(
          Selection.near(view.state.doc.resolve(entry.pos + 1)),
        );
        view.dispatch(tr);
      } catch {
        const tr = view.state.tr.setSelection(
          Selection.near(view.state.doc.resolve(entry.pos + 1)),
        );
        tr.scrollIntoView();
        view.dispatch(tr);
      }
    });
  }

  // ── Hover 事件 ──
  let leaveTimer: ReturnType<typeof setTimeout> | null = null;

  function clearLeaveTimer() {
    if (leaveTimer) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
  }

  indicatorEl.addEventListener('mouseenter', () => {
    clearLeaveTimer();
    showMenu();
  });

  indicatorEl.addEventListener('mouseleave', () => {
    clearLeaveTimer();
    leaveTimer = setTimeout(() => {
      if (!menuEl?.matches(':hover')) {
        hideMenu();
      }
    }, 200);
  });

  // 菜单也需要 hover 保持
  function onMenuEnter() { clearLeaveTimer(); }
  function onMenuLeave() {
    clearLeaveTimer();
    leaveTimer = setTimeout(() => {
      if (!indicatorEl.matches(':hover')) {
        hideMenu();
      }
    }, 200);
  }

  // ── 滚动时重新定位指示器 ──
  // NoteEditor 的 container div（overflow: auto）就是滚动容器
  const scrollContainer = editorContainer.parentElement as HTMLElement | null;
  function onScroll() {
    positionIndicator();
    if (isMenuVisible) positionMenu();
  }

  // 监听滚动容器（container div）
  if (scrollContainer) {
    scrollContainer.addEventListener('scroll', onScroll, { passive: true });
  }

  // ── update：文档变化时调用 ──
  function update() {
    entries = scanHeadings();

    // 重置 activeIndex
    if (activeIndex >= entries.length) activeIndex = entries.length - 1;

    renderLines();
    positionIndicator();
    setupObserver();

    if (isMenuVisible) renderMenu();
  }

  // ── destroy ──
  function destroy() {
    if (observer) observer.disconnect();
    indicatorEl.remove();
    if (menuEl) {
      menuEl.removeEventListener('mouseenter', onMenuEnter);
      menuEl.removeEventListener('mouseleave', onMenuLeave);
      menuEl.remove();
      menuEl = null;
    }
    scrollContainer?.removeEventListener('scroll', onScroll);
  }

  // ── 初始化（等 DOM 渲染完成）──
  requestAnimationFrame(() => update());

  return { update, destroy };
}
