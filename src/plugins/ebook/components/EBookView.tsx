import { useState, useCallback, useRef, useEffect } from 'react';
import { EBookToolbar } from './EBookToolbar';
import { FixedPageContent } from './FixedPageContent';
import { ReflowableContent } from './ReflowableContent';
import { createRenderer } from '../renderers';
import { detectFileType, isFixedPage, isReflowable } from '../types';
import type { IBookRenderer, EBookFileType } from '../types';
import '../ebook.css';

declare const viewAPI: {
  ebookGetData: () => Promise<{ filePath: string; fileName: string; data: ArrayBuffer } | null>;
  ebookClose: () => Promise<void>;
  ebookSetActiveBook: (bookId: string | null) => Promise<void>;
  ebookSaveProgress: (bookId: string, page: number) => Promise<void>;
  onEbookLoaded: (callback: (info: { bookId: string; fileName: string; fileType: string; lastPage?: number }) => void) => () => void;
};

const FIT_WIDTH_PADDING = 40; // 左右各 20px

/**
 * EBookView — L3 View 组件
 *
 * 结构：Toolbar + Content
 * 按照 ui-framework/view.md 定义的 View 结构。
 *
 * 被动加载模式：由 NavSide 书架或 Menu 触发加载，
 * EBookView 通过 onEbookLoaded 事件接收通知。
 */
export function EBookView() {
  const rendererRef = useRef<IBookRenderer | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bookIdRef = useRef<string | null>(null);
  const [rendererReady, setRendererReady] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [fitWidth, setFitWidth] = useState(true); // 默认适应宽度
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [restorePage, setRestorePage] = useState<number | null>(null);

  // 计算适应宽度的 scale
  const calcFitWidthScale = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer || !isFixedPage(renderer) || !contentRef.current) return 1.0;
    const dims = renderer.getPageDimensions();
    if (dims.length === 0) return 1.0;
    const containerWidth = contentRef.current.clientWidth - FIT_WIDTH_PADDING;
    // 使用第一页的宽度作为基准
    return containerWidth / dims[0].width;
  }, []);

  // 应用适应宽度
  const applyFitWidth = useCallback(() => {
    if (!fitWidth) return;
    const newScale = calcFitWidthScale();
    setScale(newScale);
    const renderer = rendererRef.current;
    if (renderer && isFixedPage(renderer)) {
      renderer.setScale(newScale);
    }
  }, [fitWidth, calcFitWidthScale]);

  // 窗口 resize 时重新计算适应宽度
  useEffect(() => {
    if (!fitWidth || !rendererReady) return;
    const handle = () => applyFitWidth();
    window.addEventListener('resize', handle);
    return () => window.removeEventListener('resize', handle);
  }, [fitWidth, rendererReady, applyFitWidth]);

  // 监听 EBOOK_LOADED 事件（由 NavSide 或 Menu 触发）
  useEffect(() => {
    const unsub = viewAPI.onEbookLoaded(async (info) => {
      try {
        setLoading(true);
        setFileName(info.fileName);
        bookIdRef.current = info.bookId;

        // 报告当前打开的电子书
        viewAPI.ebookSetActiveBook(info.bookId);

        // 销毁旧渲染器
        rendererRef.current?.destroy();

        // 根据文件格式创建渲染引擎
        const result = await viewAPI.ebookGetData();
        if (!result) { setLoading(false); return; }

        const fileType = (info.fileType || detectFileType(result.fileName)) as EBookFileType;
        const renderer = createRenderer(fileType);
        await renderer.load(result.data);

        rendererRef.current = renderer;

        if (isFixedPage(renderer)) {
          setPageCount(renderer.getTotalPages());
          // 适应宽度模式下延迟到渲染后计算 scale
          if (!fitWidth) {
            setScale(renderer.getScale());
          }
        } else {
          setPageCount(0);
          setScale(1.0);
        }

        setCurrentPage(info.lastPage ?? 1);
        setRestorePage(info.lastPage && info.lastPage > 1 ? info.lastPage : null);
        setRendererReady(true);
        setLoading(false);

        // 适应宽度：等 DOM 更新后计算
        if (fitWidth && isFixedPage(renderer)) {
          const fixedRenderer = renderer;
          requestAnimationFrame(() => {
            const dims = fixedRenderer.getPageDimensions();
            if (dims.length > 0 && contentRef.current) {
              const containerWidth = contentRef.current.clientWidth - FIT_WIDTH_PADDING;
              const newScale = containerWidth / dims[0].width;
              setScale(newScale);
              fixedRenderer.setScale(newScale);
            }
          });
        }
      } catch (err) {
        console.error('[EBookView] Failed to load:', err);
        setLoading(false);
      }
    });
    return unsub;
  }, [fitWidth]);

  // 保存进度（debounce 500ms）
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
    // debounce 保存进度
    if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
    progressTimerRef.current = setTimeout(() => {
      const bookId = bookIdRef.current;
      if (bookId) viewAPI.ebookSaveProgress(bookId, page);
    }, 500);
  }, []);

  const handleScaleChange = useCallback((newScale: number) => {
    setFitWidth(false); // 手动缩放时退出适应宽度模式
    setScale(newScale);
    const renderer = rendererRef.current;
    if (renderer && isFixedPage(renderer)) {
      renderer.setScale(newScale);
    }
  }, []);

  const handleFitWidthToggle = useCallback(() => {
    setFitWidth((prev) => {
      const next = !prev;
      if (next) {
        // 开启适应宽度
        requestAnimationFrame(() => {
          const renderer = rendererRef.current;
          if (!renderer || !isFixedPage(renderer) || !contentRef.current) return;
          const dims = renderer.getPageDimensions();
          if (dims.length === 0) return;
          const containerWidth = contentRef.current.clientWidth - FIT_WIDTH_PADDING;
          const newScale = containerWidth / dims[0].width;
          setScale(newScale);
          renderer.setScale(newScale);
        });
      }
      return next;
    });
  }, []);

  const renderer = rendererRef.current;

  return (
    <div className="ebook-view" ref={contentRef}>
      <EBookToolbar
        fileName={fileName}
        currentPage={currentPage}
        pageCount={pageCount}
        scale={scale}
        fitWidth={fitWidth}
        onPageChange={handlePageChange}
        onScaleChange={handleScaleChange}
        onFitWidthToggle={handleFitWidthToggle}
      />

      {loading && (
        <div className="ebook-loading">Loading...</div>
      )}

      {!loading && !rendererReady && (
        <div className="ebook-empty">
          <div className="ebook-empty__icon">📕</div>
          <div className="ebook-empty__text">在左侧书架中选择电子书</div>
        </div>
      )}

      {!loading && rendererReady && renderer && isFixedPage(renderer) && (
        <FixedPageContent
          renderer={renderer}
          scale={scale}
          initialPage={restorePage}
          onPageChange={handlePageChange}
          onScaleChange={handleScaleChange}
        />
      )}

      {!loading && rendererReady && renderer && isReflowable(renderer) && (
        <ReflowableContent
          renderer={renderer}
          onPageChange={handlePageChange}
        />
      )}
    </div>
  );
}
