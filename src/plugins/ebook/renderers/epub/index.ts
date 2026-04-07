import type { IReflowableRenderer, BookPosition, ToolbarConfig, TOCItem } from '../../types';

/**
 * EPUBRenderer — EPUB 渲染引擎
 *
 * 使用 foliate-js 的 View Web Component 渲染 EPUB。
 * foliate-js 是 ES module，通过动态 import 加载。
 */
export class EPUBRenderer implements IReflowableRenderer {
  readonly fileType = 'epub' as const;
  readonly renderMode = 'reflowable' as const;

  private view: any = null;       // foliate-js View element
  private container: HTMLElement | null = null;
  private fileData: ArrayBuffer | null = null;
  private fontSize = 16;
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

    // 动态导入 foliate-js（ES module）
    const { View } = await import('foliate-js/view.js');

    // 注册 Web Component（如果尚未注册）
    if (!customElements.get('foliate-view')) {
      customElements.define('foliate-view', View);
    }

    // 创建 View 元素
    this.view = document.createElement('foliate-view');
    this.view.style.width = '100%';
    this.view.style.height = '100%';
    this.container.appendChild(this.view);

    // 从 ArrayBuffer 创建 File 对象
    const file = new File(
      [this.fileData],
      'book.epub',
      { type: 'application/epub+zip' },
    );

    // 打开 EPUB
    await this.view.open(file);

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

    // 应用初始字体大小
    this.applyFontSize();
  }

  private convertTOC(items: any[]): TOCItem[] {
    if (!items) return [];
    return items.map((item) => ({
      label: item.label || item.title || '',
      position: { type: 'cfi' as const, cfi: item.href || '', display: item.label },
      children: item.subitems?.length ? this.convertTOC(item.subitems) : undefined,
    }));
  }

  private applyFontSize(): void {
    if (!this.view?.renderer) return;
    const style = `* { font-size: ${this.fontSize}px !important; }`;
    try {
      // foliate-js 的 renderer 有 setStyles 方法
      this.view.renderer.setStyles?.(style);
    } catch {
      // fallback: 直接注入 CSS
    }
  }

  destroy(): void {
    if (this.view && this.container) {
      this.container.removeChild(this.view);
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
    // foliate-js 通过 renderer 属性控制
    if (this.view?.renderer) {
      this.view.renderer.setAttribute?.('flow', mode === 'scrolled' ? 'scrolled' : 'paginated');
    }
  }

  onResize(): void {
    // foliate-js 的 View 自动处理 resize
  }
}
