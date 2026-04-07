import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { RenderTask } from 'pdfjs-dist/types/src/display/api';
import type { IFixedPageRenderer, BookPosition, PageDimension, ToolbarConfig, TOCItem } from '../../types';

// 配置 pdf.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

/**
 * PDFRenderer — PDF 渲染引擎
 *
 * 实现 IBookRenderer 接口，封装 pdfjs-dist 的所有操作。
 * EBookView 不直接依赖 pdfjs-dist，只通过此类交互。
 */
export class PDFRenderer implements IFixedPageRenderer {
  readonly fileType = 'pdf' as const;
  readonly renderMode = 'fixed-page' as const;

  private doc: PDFDocumentProxy | null = null;
  private pageCache = new Map<number, PDFPageProxy>();
  private pageDims: PageDimension[] = [];
  private scale = 1.0;

  // 渲染队列
  private rendering = false;
  private queue: Array<{ pageNum: number; canvas: HTMLCanvasElement; scale: number; resolve: () => void }> = [];
  private rendered = new Map<number, number>(); // pageNum → scale
  private activeTask: RenderTask | null = null;

  async load(data: ArrayBuffer): Promise<void> {
    this.destroy();
    // IPC 传输后 data 可能是 Buffer-like 对象，确保转为 Uint8Array
    const uint8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.doc = await pdfjsLib.getDocument({ data: uint8 }).promise;

    // 预计算所有页面尺寸
    this.pageDims = [];
    for (let i = 1; i <= this.doc.numPages; i++) {
      const page = await this.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      this.pageDims.push({ width: viewport.width, height: viewport.height });
    }
  }

  renderTo(_container: HTMLElement): void {
    // PDF 使用 canvas 逐页渲染（通过 renderPage），不需要整体挂载
  }

  destroy(): void {
    this.invalidateAll();
    this.pageCache.clear();
    this.pageDims = [];
    if (this.doc) {
      this.doc.destroy();
      this.doc = null;
    }
  }

  getToolbarConfig(): ToolbarConfig {
    return {
      navigation: 'page',
      zoom: 'scale',
      totalPages: this.doc?.numPages ?? null,
    };
  }

  getPageDimensions(): PageDimension[] {
    return this.pageDims;
  }

  getTotalPages(): number {
    return this.doc?.numPages ?? 0;
  }

  async getTOC(): Promise<TOCItem[]> {
    if (!this.doc) return [];
    try {
      const outline = await this.doc.getOutline();
      if (!outline) return [];
      return this.convertOutline(outline);
    } catch {
      return [];
    }
  }

  private convertOutline(items: any[]): TOCItem[] {
    return items.map((item) => ({
      label: item.title || '',
      position: { type: 'page' as const, page: 1 }, // TODO: resolve dest to page number
      children: item.items?.length ? this.convertOutline(item.items) : undefined,
    }));
  }

  getPosition(): BookPosition {
    return { type: 'page', page: 1 };
  }

  goTo(_position: BookPosition): void {
    // 由 EBookView 的 scrollToPage 处理
  }

  setScale(scale: number): void {
    this.scale = scale;
  }

  getScale(): number {
    return this.scale;
  }

  async renderPage(pageNum: number, canvas: HTMLCanvasElement, scale: number): Promise<void> {
    return new Promise((resolve) => {
      // 去重
      const idx = this.queue.findIndex((t) => t.pageNum === pageNum);
      if (idx >= 0) {
        this.queue[idx].resolve();
        this.queue[idx] = { pageNum, canvas, scale, resolve };
      } else {
        this.queue.push({ pageNum, canvas, scale, resolve });
      }
      this.processQueue();
    });
  }

  invalidateAll(): void {
    this.rendered.clear();
    if (this.activeTask) {
      this.activeTask.cancel();
      this.activeTask = null;
    }
    this.queue.forEach((t) => t.resolve());
    this.queue = [];
    this.rendering = false;
  }

  // ── Private ──

  private async getPage(pageNum: number): Promise<PDFPageProxy> {
    if (!this.doc) throw new Error('No PDF document loaded');
    const cached = this.pageCache.get(pageNum);
    if (cached) return cached;
    const page = await this.doc.getPage(pageNum);
    this.pageCache.set(pageNum, page);
    return page;
  }

  private async processQueue(): Promise<void> {
    if (this.rendering || this.queue.length === 0) return;
    this.rendering = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      const { pageNum, canvas, scale, resolve } = task;

      // 已渲染过相同 scale 则跳过
      if (this.rendered.get(pageNum) === scale) {
        resolve();
        continue;
      }

      try {
        const page = await this.getPage(pageNum);
        const dpr = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: scale * dpr });

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;

        const ctx = canvas.getContext('2d')!;
        const renderTask = page.render({ canvasContext: ctx, viewport });
        this.activeTask = renderTask;

        await renderTask.promise;
        this.activeTask = null;

        this.rendered.set(pageNum, scale);
      } catch (err: any) {
        if (err.name !== 'RenderingCancelledException') {
          console.error(`[PDFRenderer] Failed to render page ${pageNum}:`, err);
        }
      }

      resolve();
    }

    this.rendering = false;
  }
}
