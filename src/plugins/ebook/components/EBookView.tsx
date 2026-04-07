import { useState, useCallback, useRef, useEffect } from 'react';
import { EBookToolbar } from './EBookToolbar';
import { FixedPageContent } from './FixedPageContent';
import { ReflowableContent } from './ReflowableContent';
import { OutlinePanel } from './OutlinePanel';
import { SearchBar } from './SearchBar';
import type { SearchResult } from './SearchBar';
import { createRenderer } from '../renderers';
import { detectFileType, isFixedPage, isReflowable } from '../types';
import type { IBookRenderer, EBookFileType } from '../types';
import '../ebook.css';

interface EBookLoadedInfo {
  bookId: string;
  fileName: string;
  fileType: string;
  lastPage?: number;
  lastScale?: number;
  lastFitWidth?: boolean;
}

declare const viewAPI: {
  ebookGetData: () => Promise<{ filePath: string; fileName: string; data: ArrayBuffer } | null>;
  ebookClose: () => Promise<void>;
  ebookRestore: () => Promise<EBookLoadedInfo | null>;
  ebookSetActiveBook: (bookId: string | null) => Promise<void>;
  ebookSaveProgress: (bookId: string, page: number, scale?: number, fitWidth?: boolean) => Promise<void>;
  onEbookLoaded: (callback: (info: EBookLoadedInfo) => void) => () => void;
};

const FIT_WIDTH_PADDING = 40;

/**
 * EBookView — L3 View 组件
 *
 * 被动加载模式 + 启动恢复。
 */
export function EBookView() {
  const rendererRef = useRef<IBookRenderer | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bookIdRef = useRef<string | null>(null);
  const [rendererReady, setRendererReady] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [fitWidth, setFitWidth] = useState(true);
  const fitWidthRef = useRef(true);
  const scaleRef = useRef(1.0);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [restorePage, setRestorePage] = useState<number | null>(null);
  const [annotationMode, setAnnotationMode] = useState<'off' | 'rect' | 'underline'>('off');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);

  // 同步 ref
  useEffect(() => { fitWidthRef.current = fitWidth; }, [fitWidth]);
  useEffect(() => { scaleRef.current = scale; }, [scale]);

  // ── 核心加载逻辑 ──

  const loadBook = useCallback(async (info: EBookLoadedInfo) => {
    try {
      setLoading(true);
      setFileName(info.fileName);
      bookIdRef.current = info.bookId;

      viewAPI.ebookSetActiveBook(info.bookId);

      rendererRef.current?.destroy();

      const result = await viewAPI.ebookGetData();
      if (!result) { setLoading(false); return; }

      const fileType = (info.fileType || detectFileType(result.fileName)) as EBookFileType;
      const renderer = createRenderer(fileType);
      await renderer.load(result.data);

      rendererRef.current = renderer;

      // 恢复缩放模式
      const shouldFitWidth = info.lastFitWidth !== undefined ? info.lastFitWidth : true;
      setFitWidth(shouldFitWidth);

      if (isFixedPage(renderer)) {
        setPageCount(renderer.getTotalPages());
        if (!shouldFitWidth && info.lastScale) {
          setScale(info.lastScale);
          renderer.setScale(info.lastScale);
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
      if (shouldFitWidth && isFixedPage(renderer)) {
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
  }, []);

  // ── 启动时恢复上次打开的文档 ──

  useEffect(() => {
    viewAPI.ebookRestore().then((info) => {
      if (info) loadBook(info);
    });
  }, [loadBook]);

  // ── 监听 EBOOK_LOADED 事件 ──

  useEffect(() => {
    const unsub = viewAPI.onEbookLoaded((info) => loadBook(info));
    return unsub;
  }, [loadBook]);

  // ── 窗口 resize 时重新计算适应宽度 ──

  useEffect(() => {
    if (!fitWidth || !rendererReady) return;
    const handle = () => {
      const renderer = rendererRef.current;
      if (!renderer || !isFixedPage(renderer) || !contentRef.current) return;
      const dims = renderer.getPageDimensions();
      if (dims.length === 0) return;
      const containerWidth = contentRef.current.clientWidth - FIT_WIDTH_PADDING;
      const newScale = containerWidth / dims[0].width;
      setScale(newScale);
      renderer.setScale(newScale);
    };
    window.addEventListener('resize', handle);
    return () => window.removeEventListener('resize', handle);
  }, [fitWidth, rendererReady]);

  // ── 保存进度（debounce 500ms）──

  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
    if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
    progressTimerRef.current = setTimeout(() => {
      const bookId = bookIdRef.current;
      if (bookId) viewAPI.ebookSaveProgress(bookId, page, scaleRef.current, fitWidthRef.current);
    }, 500);
  }, []);

  const handleScaleChange = useCallback((newScale: number) => {
    setFitWidth(false);
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

  // Cmd+F 搜索
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setSearchVisible(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = useCallback((query: string) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(async () => {
      const r = rendererRef.current;
      if (!r || !isFixedPage(r) || !query.trim()) {
        setSearchResults([]);
        setSearchIndex(0);
        return;
      }
      const results = await r.searchText(query.trim());
      setSearchResults(results);
      setSearchIndex(0);
      if (results.length > 0) {
        window.dispatchEvent(new CustomEvent('ebook:goto-page', { detail: results[0].pageNum }));
      }
    }, 300);
  }, []);

  const handleSearchNext = useCallback(() => {
    if (searchResults.length === 0) return;
    const next = (searchIndex + 1) % searchResults.length;
    setSearchIndex(next);
    window.dispatchEvent(new CustomEvent('ebook:goto-page', { detail: searchResults[next].pageNum }));
  }, [searchResults, searchIndex]);

  const handleSearchPrev = useCallback(() => {
    if (searchResults.length === 0) return;
    const prev = (searchIndex - 1 + searchResults.length) % searchResults.length;
    setSearchIndex(prev);
    window.dispatchEvent(new CustomEvent('ebook:goto-page', { detail: searchResults[prev].pageNum }));
  }, [searchResults, searchIndex]);

  const handleSearchClose = useCallback(() => {
    setSearchVisible(false);
    setSearchResults([]);
    setSearchIndex(0);
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
        annotationMode={annotationMode}
        sidebarOpen={sidebarOpen}
        onPageChange={handlePageChange}
        onScaleChange={handleScaleChange}
        onFitWidthToggle={handleFitWidthToggle}
        onAnnotationModeChange={setAnnotationMode}
        onSidebarToggle={() => setSidebarOpen((p) => !p)}
      />

      <SearchBar
        visible={searchVisible}
        results={searchResults}
        currentIndex={searchIndex}
        onSearch={handleSearch}
        onNext={handleSearchNext}
        onPrev={handleSearchPrev}
        onClose={handleSearchClose}
      />

      <div className="ebook-body">
        {/* Sidebar */}
        {sidebarOpen && rendererReady && renderer && (
          <OutlinePanel
            renderer={renderer}
            onGoToPage={(page) => {
              handlePageChange(page);
              window.dispatchEvent(new CustomEvent('ebook:goto-page', { detail: page }));
            }}
            onClose={() => setSidebarOpen(false)}
          />
        )}

        {/* Content */}
        <div className="ebook-body__content">
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
              annotationMode={annotationMode}
              bookId={bookIdRef.current}
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
      </div>
    </div>
  );
}
