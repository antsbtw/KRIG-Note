import { useRef, useEffect, useState, useCallback } from 'react';
import type { IFixedPageRenderer, PageDimension } from '../types';

interface FixedPageContentProps {
  renderer: IFixedPageRenderer;
  scale: number;
  initialPage?: number | null;
  onPageChange: (page: number) => void;
  onScaleChange: (scale: number) => void;
}

const PAGE_GAP = 8;
const BUFFER_PAGES = 1;

/**
 * FixedPageContent — 固定页面格式的连续滚动渲染器
 *
 * 通过 IFixedPageRenderer 接口渲染页面，不直接依赖任何格式的库。
 * 适用于 PDF、DjVu、CBZ 等固定页面格式。
 */
export function FixedPageContent({ renderer, scale, initialPage, onPageChange, onScaleChange }: FixedPageContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefsRef = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const [pageDimensions, setPageDimensions] = useState<PageDimension[]>([]);
  const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set());
  const prevScaleRef = useRef(scale);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const totalPages = renderer.getTotalPages();

  // 加载页面尺寸
  useEffect(() => {
    setPageDimensions(renderer.getPageDimensions());
  }, [renderer]);

  // IntersectionObserver 检测可见页面
  useEffect(() => {
    if (!containerRef.current || pageDimensions.length === 0) return;

    const container = containerRef.current;
    const visible = new Set<number>();

    // 延迟到下一帧，确保 page wrapper DOM 已渲染
    const raf = requestAnimationFrame(() => {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          let changed = false;
          for (const entry of entries) {
            const pageNum = parseInt(entry.target.getAttribute('data-page') || '0', 10);
            if (pageNum === 0) continue;

            if (entry.isIntersecting) {
              if (!visible.has(pageNum)) { visible.add(pageNum); changed = true; }
            } else {
              if (visible.has(pageNum)) { visible.delete(pageNum); changed = true; }
            }
          }
          if (changed) {
            setVisiblePages(new Set(visible));
            if (visible.size > 0) {
              const sorted = Array.from(visible).sort((a, b) => a - b);
              onPageChange(sorted[0]);
            }
          }
        },
        {
          root: container,
          rootMargin: '200px 0px',
          threshold: 0.1,
        },
      );

      const wrappers = container.querySelectorAll('[data-page]');
      wrappers.forEach((el) => observerRef.current!.observe(el));
    });

    return () => {
      cancelAnimationFrame(raf);
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, [pageDimensions, onPageChange]);

  // Scale 变化时重新渲染
  useEffect(() => {
    if (prevScaleRef.current !== scale) {
      prevScaleRef.current = scale;
      renderer.invalidateAll();
      setVisiblePages((prev) => new Set(prev));
    }
  }, [scale, renderer]);

  // 渲染可见页面 + buffer
  useEffect(() => {
    if (pageDimensions.length === 0) return;

    const toRender = new Set<number>();
    for (const p of visiblePages) {
      for (let i = p - BUFFER_PAGES; i <= p + BUFFER_PAGES; i++) {
        if (i >= 1 && i <= totalPages) toRender.add(i);
      }
    }

    for (const pageNum of toRender) {
      const canvas = pageRefsRef.current.get(pageNum);
      if (canvas) {
        renderer.renderPage(pageNum, canvas, scale);
      }
    }
  }, [visiblePages, scale, pageDimensions, totalPages, renderer]);

  // 滚动到指定页
  const scrollToPage = useCallback((pageNum: number) => {
    const container = containerRef.current;
    if (!container || pageDimensions.length === 0) return;

    let top = 16;
    for (let i = 0; i < pageNum - 1; i++) {
      top += pageDimensions[i].height * scale + PAGE_GAP;
    }

    container.scrollTo({ top, behavior: 'smooth' });
  }, [pageDimensions, scale]);

  // 恢复阅读位置（首次加载时）
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !initialPage || pageDimensions.length === 0) return;
    restoredRef.current = true;
    // 延迟到渲染完成后滚动
    requestAnimationFrame(() => scrollToPage(initialPage));
  }, [initialPage, pageDimensions, scrollToPage]);

  // 监听 Toolbar 页码跳转
  useEffect(() => {
    const handler = (e: Event) => {
      const page = (e as CustomEvent<number>).detail;
      scrollToPage(page);
    };
    window.addEventListener('ebook:goto-page', handler);
    return () => window.removeEventListener('ebook:goto-page', handler);
  }, [scrollToPage]);

  // 键盘缩放
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        onScaleChange(Math.min(scale + 0.25, 3.0));
      } else if (e.key === '-') {
        e.preventDefault();
        onScaleChange(Math.max(scale - 0.25, 0.25));
      } else if (e.key === '0') {
        e.preventDefault();
        onScaleChange(1.0);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [scale, onScaleChange]);

  // Ctrl+滚轮缩放
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handler = (e: WheelEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const next = Math.max(0.25, Math.min(3.0, scale + delta));
      onScaleChange(Math.round(next * 100) / 100);
    };
    container.addEventListener('wheel', handler, { passive: false });
    return () => container.removeEventListener('wheel', handler);
  }, [scale, onScaleChange]);

  if (pageDimensions.length === 0) {
    return <div className="ebook-loading">Preparing pages...</div>;
  }

  return (
    <div className="ebook-content" ref={containerRef}>
      <div className="ebook-content__pages">
        {pageDimensions.map((dim, i) => {
          const pageNum = i + 1;
          const w = Math.floor(dim.width * scale);
          const h = Math.floor(dim.height * scale);

          return (
            <div
              key={pageNum}
              className="ebook-content__page-wrapper"
              data-page={pageNum}
              style={{ width: w, height: h }}
            >
              <canvas
                ref={(el) => {
                  if (el) pageRefsRef.current.set(pageNum, el);
                  else pageRefsRef.current.delete(pageNum);
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
