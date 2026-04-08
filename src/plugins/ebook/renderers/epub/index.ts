import type { IReflowableRenderer, BookPosition, ToolbarConfig, TOCItem } from '../../types';

/**
 * EPUBRenderer — EPUB 渲染引擎
 *
 * 使用 foliate-js 的 View Web Component 渲染 EPUB。
 * 作为 foliate-js 的适配层，隔离 API 变更风险。
 */
export class EPUBRenderer implements IReflowableRenderer {
  readonly fileType = 'epub' as const;
  readonly renderMode = 'reflowable' as const;

  private view: any = null;
  private container: HTMLElement | null = null;
  private fileData: ArrayBuffer | null = null;
  private fontSize = 100;
  private currentProgress = { chapter: '', percentage: 0 };
  private lastCFI: string | null = null;
  private lastLocationToRestore: string | null = null;
  private tocItems: TOCItem[] = [];
  private relocateCallbacks: Array<(progress: { chapter: string; percentage: number }) => void> = [];
  private readyResolve: (() => void) | null = null;
  private readyPromise: Promise<void> = new Promise((r) => { this.readyResolve = r; });

  async load(data: ArrayBuffer): Promise<void> {
    this.fileData = data;
  }

  renderTo(container: HTMLElement): void {
    this.container = container;
    this.initView();
  }

  private async initView(): Promise<void> {
    if (!this.container || !this.fileData) return;

    try {
      const { View } = await import('foliate-js/view.js');

      if (!customElements.get('foliate-view')) {
        customElements.define('foliate-view', View);
      }

      this.view = document.createElement('foliate-view');
      this.view.style.display = 'block';
      this.view.style.width = '100%';
      this.view.style.height = '100%';
      this.container.appendChild(this.view);

      // 等待 DOM 布局完成
      await new Promise((r) => requestAnimationFrame(r));

      const file = new File(
        [this.fileData],
        'book.epub',
        { type: 'application/epub+zip' },
      );

      // 打开 EPUB
      await this.view.open(file);

      // 设置单栏布局 + 默认字体大小
      if (this.view.renderer) {
        this.view.renderer.setAttribute('max-column-count', '1');
        this.view.renderer.setAttribute('max-inline-size', '720');
      }

      // 显示内容（恢复上次位置或从头开始）
      await this.view.init({
        lastLocation: this.lastLocationToRestore ?? null,
        showTextStart: !this.lastLocationToRestore,
      });

      // 应用缩放
      this.applyZoom();

      // 监听位置变化
      this.view.addEventListener('relocate', (e: any) => {
        const detail = e.detail;
        if (detail) {
          this.currentProgress = {
            chapter: detail.tocItem?.label ?? '',
            percentage: detail.fraction ?? 0,
          };
          if (detail.cfi) this.lastCFI = detail.cfi;
          this.relocateCallbacks.forEach((cb) => cb(this.currentProgress));
        }
      });

      // 设置文本选择监听（标注入口）
      this.setupSelectionListener();

      // 点击已有标注 → 触发回调（用于删除）
      this.view.addEventListener('show-annotation', (e: any) => {
        const cfi = e.detail?.value;
        if (cfi && this.annotationClickCallback) {
          this.annotationClickCallback(cfi);
        }
      });

      // 高亮绘制：根据 annotation.color 自定义颜色
      this.view.addEventListener('draw-annotation', (e: any) => {
        const { draw, annotation } = e.detail;
        const color = annotation?.color || '#ffd43b';
        draw((range: any, options: any) => {
          // 使用 foliate-js Overlayer.highlight
          const { Overlayer } = (self as any).__foliateOverlayer || {};
          if (Overlayer) return Overlayer.highlight(range, { ...options, color });
          // fallback: 简单矩形
          const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          g.setAttribute('fill', color);
          g.style.opacity = '0.3';
          for (const { left, top, height, width } of range) {
            const el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            el.setAttribute('x', String(left));
            el.setAttribute('y', String(top));
            el.setAttribute('height', String(height));
            el.setAttribute('width', String(width));
            g.append(el);
          }
          return g;
        }, { color });
      });

      // 提取 TOC
      if (this.view.book?.toc) {
        this.tocItems = this.convertTOC(this.view.book.toc);
      }

      // 标记初始化完成
      this.readyResolve?.();
    } catch (err) {
      console.error('[EPUBRenderer] initView failed:', err);
      this.readyResolve?.(); // 即使失败也 resolve，避免永远挂起
    }
  }

  private convertTOC(items: any[]): TOCItem[] {
    if (!items) return [];
    return items.map((item) => ({
      label: item.label || item.title || '',
      position: { type: 'cfi' as const, cfi: item.href || '', display: item.label },
      children: item.subitems?.length ? this.convertTOC(item.subitems) : undefined,
    }));
  }

  destroy(): void {
    if (this.view && this.container) {
      try { this.container.removeChild(this.view); } catch { /* ignore */ }
    }
    this.view = null;
    this.container = null;
    this.fileData = null;
    this.tocItems = [];
  }

  getToolbarConfig(): ToolbarConfig {
    return {
      navigation: 'chapter',
      zoom: 'fontSize',
      totalPages: null,
    };
  }

  getPosition(): BookPosition {
    return {
      type: 'cfi',
      cfi: '',
      display: `${this.currentProgress.chapter} · ${Math.round(this.currentProgress.percentage * 100)}%`,
    };
  }

  async goTo(position: BookPosition): Promise<void> {
    await this.readyPromise;
    if (!this.view) return;
    if (position.type === 'cfi' && position.cfi) {
      await this.view.goTo(position.cfi);
    }
  }

  async getTOC(): Promise<TOCItem[]> {
    await this.readyPromise;
    return this.tocItems;
  }

  // ── IReflowableRenderer ──

  setFontSize(size: number): void {
    this.fontSize = size;
    this.applyZoom();
  }

  private applyZoom(): void {
    if (!this.view) return;
    // 使用 CSS zoom 整体缩放（文本+图片都会放大/缩小）
    this.view.style.zoom = `${this.fontSize}%`;
  }

  getFontSize(): number {
    return this.fontSize;
  }

  getProgress(): { chapter: string; percentage: number } {
    return this.currentProgress;
  }

  nextChapter(): void {
    // 使用 View 的 next()（翻页），不是 renderer 的 next()
    this.view?.next?.();
  }

  prevChapter(): void {
    this.view?.prev?.();
  }

  setDisplayMode(mode: 'paginated' | 'scrolled'): void {
    if (this.view?.renderer) {
      this.view.renderer.setAttribute?.('flow', mode === 'scrolled' ? 'scrolled' : 'paginated');
    }
  }

  onResize(): void {
    // foliate-js 的 View 通过 ResizeObserver 自动处理
  }

  // ── 进度保存/恢复 ──

  getLastCFI(): string | null {
    return this.lastCFI;
  }

  setRestoreLocation(cfi: string): void {
    this.lastLocationToRestore = cfi;
  }

  onRelocate(callback: (progress: { chapter: string; percentage: number }) => void): void {
    this.relocateCallbacks.push(callback);
  }

  // ── 标注 ──

  private annotationCallback: ((info: { cfi: string; text: string; x: number; y: number }) => void) | null = null;
  private annotationClickCallback: ((cfi: string) => void) | null = null;

  onTextSelected(callback: (info: { cfi: string; text: string; x: number; y: number }) => void): void {
    this.annotationCallback = callback;
  }

  onAnnotationClick(callback: (cfi: string) => void): void {
    this.annotationClickCallback = callback;
  }

  private setupSelectionListener(): void {
    if (!this.view) return;

    const attachMouseup = (doc: any, index: number) => {
      if (!doc || doc.__ebookMouseupAttached) return;
      doc.__ebookMouseupAttached = true;

      doc.addEventListener('mouseup', (e: MouseEvent) => {
        const sel = doc.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) return;

        const range = sel.getRangeAt(0);
        const text = sel.toString().trim();
        if (!text) return;

        const cfi = this.view.getCFI(index, range);
        if (cfi && this.annotationCallback) {
          // 获取选区末尾坐标（相对于 eBook view 容器）
          const rect = range.getBoundingClientRect();
          const viewRect = this.container?.getBoundingClientRect();
          const x = rect.left + rect.width / 2 - (viewRect?.left ?? 0);
          const y = rect.bottom - (viewRect?.top ?? 0);
          this.annotationCallback({ cfi, text, x, y });
        }
      });
    };

    // 给已加载的 section 绑定
    const contents = this.view.renderer?.getContents?.();
    if (contents) {
      for (const { doc, index } of contents) {
        attachMouseup(doc, index);
      }
    }

    // 给后续加载的 section 绑定
    this.view.addEventListener('load', (e: any) => {
      const { doc, index } = e.detail;
      attachMouseup(doc, index);
    });
  }

  addHighlight(cfi: string, color: string): void {
    if (!this.view) return;
    this.view.addAnnotation({ value: cfi, color });
  }

  removeHighlight(cfi: string): void {
    this.view?.deleteAnnotation({ value: cfi });
  }

  // ── 搜索 ──

  async searchText(query: string): Promise<Array<{ pageNum: number; index: number; text: string }>> {
    await this.readyPromise;
    if (!this.view || !query) return [];

    const results: Array<{ pageNum: number; index: number; text: string }> = [];
    try {
      for await (const result of this.view.search({ query })) {
        if (result === 'done') break;
        if (result.subitems) {
          for (const sub of result.subitems) {
            results.push({
              pageNum: sub.index ?? 0,
              index: results.length,
              text: sub.excerpt ?? query,
            });
          }
        } else if (result.excerpt) {
          results.push({
            pageNum: result.index ?? 0,
            index: results.length,
            text: result.excerpt,
          });
        }
      }
    } catch {
      // 搜索可能被中断
    }
    return results;
  }

  clearSearch(): void {
    this.view?.clearSearch?.();
  }
}
