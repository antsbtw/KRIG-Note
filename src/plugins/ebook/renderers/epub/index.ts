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
  private fontSize = 20;
  private currentProgress = { chapter: '', percentage: 0 };
  private tocItems: TOCItem[] = [];

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
        this.view.renderer.setAttribute('max-inline-size', '960');
      }

      // 显示第一节
      await this.view.init({ lastLocation: null, showTextStart: true });

      // 应用字体大小
      this.applyFontSize();

      // 监听位置变化
      this.view.addEventListener('relocate', (e: any) => {
        const detail = e.detail;
        if (detail) {
          this.currentProgress = {
            chapter: detail.tocItem?.label ?? '',
            percentage: detail.fraction ?? 0,
          };
        }
      });

      // 提取 TOC
      if (this.view.book?.toc) {
        this.tocItems = this.convertTOC(this.view.book.toc);
      }
    } catch (err) {
      console.error('[EPUBRenderer] initView failed:', err);
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

  goTo(position: BookPosition): void {
    if (!this.view) return;
    if (position.type === 'cfi' && position.cfi) {
      const resolved = this.view.resolveNavigation?.(position.cfi);
      if (resolved) this.view.renderer?.goTo?.(resolved);
    }
  }

  async getTOC(): Promise<TOCItem[]> {
    return this.tocItems;
  }

  // ── IReflowableRenderer ──

  setFontSize(size: number): void {
    this.fontSize = size;
    this.applyFontSize();
  }

  private applyFontSize(): void {
    if (!this.view?.renderer?.setStyles) return;
    this.view.renderer.setStyles(`
      body, p, div, span, li, td, th, a, em, strong, blockquote, h1, h2, h3, h4, h5, h6 {
        font-size: ${this.fontSize}px !important;
        line-height: 1.6 !important;
      }
    `);
  }

  getFontSize(): number {
    return this.fontSize;
  }

  getProgress(): { chapter: string; percentage: number } {
    return this.currentProgress;
  }

  nextChapter(): void {
    this.view?.renderer?.next?.();
  }

  prevChapter(): void {
    this.view?.renderer?.prev?.();
  }

  setDisplayMode(mode: 'paginated' | 'scrolled'): void {
    if (this.view?.renderer) {
      this.view.renderer.setAttribute?.('flow', mode === 'scrolled' ? 'scrolled' : 'paginated');
    }
  }

  onResize(): void {
    // foliate-js 的 View 通过 ResizeObserver 自动处理
  }
}
