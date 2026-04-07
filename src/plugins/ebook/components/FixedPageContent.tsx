import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import type { IFixedPageRenderer, PageDimension } from '../types';
import { AnnotationLayer } from './AnnotationLayer';
import type { Annotation } from './AnnotationLayer';

declare const viewAPI: {
  ebookAnnotationList: (bookId: string) => Promise<any[]>;
  ebookAnnotationAdd: (bookId: string, ann: unknown) => Promise<any>;
  ebookAnnotationRemove: (bookId: string, annotationId: string) => Promise<void>;
};

interface FixedPageContentProps {
  renderer: IFixedPageRenderer;
  scale: number;
  initialPage?: number | null;
  annotationMode?: 'off' | 'rect' | 'underline';
  bookId?: string | null;
  onPageChange: (page: number) => void;
  onScaleChange: (scale: number) => void;
}

const PAGE_GAP = 8;
const PADDING_TOP = 16;
const DOM_BUFFER = 5; // 可见区域外多渲染 5 页的 DOM

/**
 * FixedPageContent — 固定页面格式的连续滚动渲染器
 *
 * DOM 虚拟化：只创建可见区域 ± DOM_BUFFER 页的 DOM 元素，
 * 其余用 spacer div 占位。大幅减少 DOM 节点数量。
 */
export function FixedPageContent({ renderer, scale, initialPage, annotationMode = 'off', bookId, onPageChange, onScaleChange }: FixedPageContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefsRef = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const textLayerRefsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const [annotations, setAnnotations] = useState<any[]>([]);
  const [pageDimensions, setPageDimensions] = useState<PageDimension[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = renderer.getTotalPages();

  // 加载页面尺寸
  useEffect(() => {
    setPageDimensions(renderer.getPageDimensions());
  }, [renderer]);

  // 加载标注数据
  useEffect(() => {
    if (!bookId) return;
    viewAPI.ebookAnnotationList(bookId).then(setAnnotations);
  }, [bookId]);

  // 预计算每页的 Y 偏移（scale=1 下，乘以 scale 即可得到实际偏移）
  const pageOffsets = useMemo(() => {
    const offsets: number[] = [];
    let y = PADDING_TOP;
    for (const dim of pageDimensions) {
      offsets.push(y);
      y += dim.height + PAGE_GAP;
    }
    return offsets;
  }, [pageDimensions]);

  // 总高度
  const totalHeight = useMemo(() => {
    if (pageDimensions.length === 0) return 0;
    const last = pageOffsets[pageOffsets.length - 1];
    const lastH = pageDimensions[pageDimensions.length - 1].height;
    return (last + lastH + PADDING_TOP) * scale;
  }, [pageDimensions, pageOffsets, scale]);

  // 根据 scrollTop 计算当前可见页范围
  const getVisibleRange = useCallback(() => {
    const container = containerRef.current;
    if (!container || pageDimensions.length === 0) return { first: 1, last: 1 };

    const scrollTop = container.scrollTop / scale;
    const viewHeight = container.clientHeight / scale;
    const scrollBottom = scrollTop + viewHeight;

    let first = 1;
    let last = 1;

    // 二分查找第一个可见页
    let lo = 0, hi = pageDimensions.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const pageBottom = pageOffsets[mid] + pageDimensions[mid].height;
      if (pageBottom < scrollTop) lo = mid + 1;
      else hi = mid - 1;
    }
    first = lo + 1; // 转为 1-based

    // 找最后一个可见页
    for (let i = lo; i < pageDimensions.length; i++) {
      if (pageOffsets[i] > scrollBottom) break;
      last = i + 1;
    }

    return { first: Math.max(1, first), last: Math.min(totalPages, last) };
  }, [pageDimensions, pageOffsets, scale, totalPages]);

  // 滚动事件 → 更新当前页 + 触发渲染
  useEffect(() => {
    const container = containerRef.current;
    if (!container || pageDimensions.length === 0) return;

    let rafId = 0;
    const onScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const { first } = getVisibleRange();
        setCurrentPage(first);
        onPageChange(first);
      });
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    // 初始触发
    onScroll();

    return () => {
      container.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(rafId);
    };
  }, [pageDimensions, getVisibleRange, onPageChange]);

  // 计算 DOM 渲染范围（可见页 ± DOM_BUFFER）
  const domRange = useMemo(() => {
    const first = Math.max(1, currentPage - DOM_BUFFER);
    const last = Math.min(totalPages, currentPage + DOM_BUFFER + Math.ceil((containerRef.current?.clientHeight ?? 800) / ((pageDimensions[0]?.height ?? 800) * scale)));
    return { first, last };
  }, [currentPage, totalPages, pageDimensions, scale]);

  // 渲染可见页面的 canvas + textLayer
  useEffect(() => {
    if (pageDimensions.length === 0) return;

    const { first, last } = getVisibleRange();
    const renderFirst = Math.max(1, first - 1);
    const renderLast = Math.min(totalPages, last + 1);

    for (let pageNum = renderFirst; pageNum <= renderLast; pageNum++) {
      const canvas = pageRefsRef.current.get(pageNum);
      if (canvas) {
        renderer.renderPage(pageNum, canvas, scale);
      }
      const textDiv = textLayerRefsRef.current.get(pageNum);
      if (textDiv) {
        renderer.renderTextLayer(pageNum, textDiv, scale);
      }
    }
  }, [currentPage, scale, pageDimensions, totalPages, renderer, getVisibleRange]);

  // 标注操作
  const handleAnnotationCreate = useCallback(async (pageNum: number, ann: Omit<Annotation, 'id'>) => {
    if (!bookId) return;
    const stored = await viewAPI.ebookAnnotationAdd(bookId, { ...ann, pageNum });
    setAnnotations((prev) => [...prev, stored]);
  }, [bookId]);

  const handleAnnotationDelete = useCallback(async (annId: string) => {
    if (!bookId) return;
    await viewAPI.ebookAnnotationRemove(bookId, annId);
    setAnnotations((prev) => prev.filter((a) => a.id !== annId));
  }, [bookId]);

  // 滚动到指定页
  const scrollToPage = useCallback((pageNum: number) => {
    const container = containerRef.current;
    if (!container || pageOffsets.length === 0) return;
    const idx = Math.max(0, Math.min(pageNum - 1, pageOffsets.length - 1));
    container.scrollTo({ top: pageOffsets[idx] * scale, behavior: 'smooth' });
  }, [pageOffsets, scale]);

  // 恢复阅读位置（首次加载时）
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !initialPage || pageDimensions.length === 0) return;
    restoredRef.current = true;
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

  // 计算 spacer 高度
  const topSpacerHeight = domRange.first > 1
    ? pageOffsets[domRange.first - 1] * scale
    : 0;

  const bottomSpacerStart = domRange.last < totalPages
    ? (pageOffsets[domRange.last] + pageDimensions[domRange.last].height) * scale + PAGE_GAP
    : totalHeight;

  return (
    <div className="ebook-content" ref={containerRef}>
      <div className="ebook-content__pages" style={{ minHeight: totalHeight }}>
        {/* 顶部占位 */}
        {topSpacerHeight > 0 && <div style={{ height: topSpacerHeight, flexShrink: 0 }} />}

        {/* 只渲染 domRange 范围内的页面 */}
        {pageDimensions.slice(domRange.first - 1, domRange.last).map((dim, idx) => {
          const pageNum = domRange.first + idx;
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
              <div
                className="textLayer"
                ref={(el) => {
                  if (el) textLayerRefsRef.current.set(pageNum, el);
                  else textLayerRefsRef.current.delete(pageNum);
                }}
              />
              <AnnotationLayer
                pageNum={pageNum}
                scale={scale}
                pageWidth={dim.width}
                pageHeight={dim.height}
                mode={annotationMode}
                annotations={annotations.filter((a) => a.pageNum === pageNum)}
                onAnnotationCreate={handleAnnotationCreate}
                onAnnotationDelete={handleAnnotationDelete}
              />
            </div>
          );
        })}

        {/* 底部占位 */}
        {bottomSpacerStart < totalHeight && (
          <div style={{ height: totalHeight - bottomSpacerStart, flexShrink: 0 }} />
        )}
      </div>
    </div>
  );
}
