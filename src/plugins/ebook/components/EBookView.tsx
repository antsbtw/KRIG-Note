import { useState, useCallback, useRef, useEffect } from 'react';
import { EBookToolbar } from './EBookToolbar';
import { FixedPageContent } from './FixedPageContent';
import { ReflowableContent } from './ReflowableContent';
import { OutlinePanel } from './OutlinePanel';
import { SearchBar } from './SearchBar';
import { createRenderer } from '../renderers';
import { detectFileType, isFixedPage, isReflowable } from '../types';
import { useBookmarks } from '../hooks/useBookmarks';
import { useSearch } from '../hooks/useSearch';
import { useEpubAnnotation } from '../hooks/useEpubAnnotation';
import type { IBookRenderer, EBookFileType } from '../types';
import '../ebook.css';

const FIT_WIDTH_PADDING = 40;
const ANCHOR_SYNC_DEBOUNCE_MS = 300;
const EPUB_COLORS = ['#ffd43b', '#69db7c', '#74c0fc', '#b197fc', '#ff6b6b'];

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
  const [bookId, setBookId] = useState<string | null>(null);
  const [epubProgress, setEpubProgress] = useState<{ chapter: string; percentage: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [restorePage, setRestorePage] = useState<number | null>(null);
  const [annotationMode, setAnnotationMode] = useState<'off' | 'rect' | 'underline'>('off');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // FixedPageContent 跳转回调（替代 CustomEvent）
  const gotoPageRef = useRef<((page: number) => void) | null>(null);
  const registerGotoPage = useCallback((fn: (page: number) => void) => {
    gotoPageRef.current = fn;
  }, []);
  const gotoPage = useCallback((page: number) => {
    gotoPageRef.current?.(page);
  }, []);

  // EPUB 跳转
  const gotoCFI = useCallback((cfi: string) => {
    const r = rendererRef.current;
    if (r && isReflowable(r)) {
      r.goTo({ type: 'cfi', cfi });
    }
  }, []);

  // 同步 ref
  useEffect(() => { fitWidthRef.current = fitWidth; }, [fitWidth]);
  useEffect(() => { scaleRef.current = scale; }, [scale]);

  // ── Hooks ──

  const { bookmarks, cfiBookmarks, loadBookmarks, loadCfiBookmarks, toggleBookmark, isBookmarked } =
    useBookmarks({ bookIdRef, rendererRef, epubProgress });

  const { searchVisible, searchResults, searchIndex, openSearch, handleSearch, handleSearchNext, handleSearchPrev, handleSearchClose } =
    useSearch({ rendererRef, onGotoPage: gotoPage, onGotoCFI: gotoCFI });

  const { epubSelection, registerCallbacks: registerAnnotationCallbacks, loadAnnotations, createAnnotation, dismissSelection } =
    useEpubAnnotation({ bookIdRef, rendererRef });

  // ── PDF 提取 ──

  const handleExtract = useCallback(async () => {
    console.log('[EBookView] Extract clicked — opening Right Slot + uploading PDF...');
    try {
      const result = await (viewAPI as any).extractionOpen();
      console.log('[EBookView] Extract result:', JSON.stringify(result));
    } catch (err) {
      console.error('[EBookView] Extract error:', err);
    }
  }, []);

  // ── 保存进度（debounce 500ms）──

  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 锚定同步（debounce）──
  // 左主右从：仅当本 View 位于 left slot 时发射 anchor-sync。

  const anchorSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slotSideRef = useRef<'primary' | 'companion' | null>(null);

  useEffect(() => {
    (viewAPI as any).getMyRole?.().then((side: 'primary' | 'companion' | null) => {
      slotSideRef.current = side;
    });
  }, []);

  const sendAnchorSync = useCallback((page: number) => {
    if (slotSideRef.current !== 'primary') return;
    if (anchorSyncTimerRef.current) clearTimeout(anchorSyncTimerRef.current);
    anchorSyncTimerRef.current = setTimeout(() => {
      (viewAPI as any).sendToOtherSlot({
        protocol: '',
        action: 'anchor-sync',
        payload: { anchorType: 'pdf-page', pdfPage: page },
      });
    }, ANCHOR_SYNC_DEBOUNCE_MS);
  }, []);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
    sendAnchorSync(page);
    if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
    progressTimerRef.current = setTimeout(() => {
      const bookId = bookIdRef.current;
      const r = rendererRef.current;
      const cfi = (r && isReflowable(r)) ? r.getLastCFI?.() : undefined;
      if (bookId) viewAPI.ebookSaveProgress(bookId, { page, scale: scaleRef.current, fitWidth: fitWidthRef.current, cfi: cfi ?? undefined });
    }, 500);
  }, [sendAnchorSync]);

  // ── 核心加载逻辑 ──

  const loadBook = useCallback(async (info: EBookLoadedInfo) => {
    try {
      setLoading(true);
      setRendererReady(false);
      setFileName(info.fileName);
      setBookId(info.bookId);
      bookIdRef.current = info.bookId;

      viewAPI.ebookSetActiveBook(info.bookId);

      rendererRef.current?.destroy();

      const result = await viewAPI.ebookGetData();
      if (!result) { setLoading(false); return; }

      const fileType = (info.fileType || detectFileType(result.fileName)) as EBookFileType;
      const renderer = createRenderer(fileType);
      await renderer.load(result.data);

      const pos = info.lastPosition;

      // EPUB: 设置恢复位置（在 renderTo 之前，因为 renderTo 触发 initView）
      if (isReflowable(renderer) && pos?.cfi) {
        renderer.setRestoreLocation(pos.cfi);
      }

      rendererRef.current = renderer;

      // 恢复缩放模式
      const shouldFitWidth = pos?.fitWidth !== undefined ? pos.fitWidth : true;
      setFitWidth(shouldFitWidth);

      if (isFixedPage(renderer)) {
        setPageCount(renderer.getTotalPages());
        if (!shouldFitWidth && pos?.scale) {
          setScale(pos.scale);
          renderer.setScale(pos.scale);
        }
      } else {
        setPageCount(0);
        setScale(1.0);
      }

      setCurrentPage(pos?.page ?? 1);
      setRestorePage(pos?.page && pos.page > 1 ? pos.page : null);
      setRendererReady(true);
      setLoading(false);

      // 加载书签
      loadBookmarks(info.bookId);

      // EPUB: 注册进度变化回调 + 标注回调
      if (isReflowable(renderer)) {
        renderer.onRelocate((progress) => {
          setEpubProgress(progress);
          handlePageChange(0);
        });
        registerAnnotationCallbacks(renderer);
        loadCfiBookmarks(info.bookId);
        loadAnnotations(info.bookId, renderer);
      }

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
  }, [loadBookmarks, loadCfiBookmarks, loadAnnotations, registerAnnotationCallbacks, handlePageChange]);

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

  // ── 接收锚定同步消息（从 NoteView 发来的页码） ──

  useEffect(() => {
    const unsub = (viewAPI as any).onMessage((message: any) => {
      console.log('[EBookView:anchor] onMessage received:', JSON.stringify(message));
      if (message?.action !== 'anchor-sync') return;
      const { anchorType, pdfPage } = message.payload || {};
      if (anchorType === 'pdf-page' && typeof pdfPage === 'number' && pdfPage > 0) {
        console.log(`[EBookView:anchor] Jumping to page ${pdfPage}`);
        const renderer = rendererRef.current;
        if (renderer && isFixedPage(renderer)) {
          gotoPage(pdfPage);
        }
        setCurrentPage(pdfPage);
      }
    });
    return unsub;
  }, [gotoPage]);

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

  // 点击 picker 外部时关闭（主窗口层面的点击）
  useEffect(() => {
    if (!epubSelection) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.epub-annotation-picker')) return;
      dismissSelection();
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [epubSelection, dismissSelection]);

  // Cmd+F 搜索 / Cmd+D 书签 / Arrow 章节导航
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        openSearch();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault();
        toggleBookmark(currentPage);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const r = rendererRef.current;
        if (r && isReflowable(r)) {
          e.preventDefault();
          if (e.key === 'ArrowLeft') r.prevChapter();
          else r.nextChapter();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentPage, openSearch, toggleBookmark]);

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
        renderMode={renderer?.renderMode ?? 'fixed-page'}
        epubProgress={epubProgress}
        onPageChange={(page) => { handlePageChange(page); gotoPage(page); }}
        onScaleChange={handleScaleChange}
        onFitWidthToggle={handleFitWidthToggle}
        onAnnotationModeChange={setAnnotationMode}
        onSidebarToggle={() => setSidebarOpen((p) => !p)}
        onPrevChapter={() => {
          if (renderer && isReflowable(renderer)) renderer.prevChapter();
        }}
        onNextChapter={() => {
          if (renderer && isReflowable(renderer)) renderer.nextChapter();
        }}
        onFontSizeChange={(delta) => {
          if (renderer && isReflowable(renderer)) {
            const current = renderer.getFontSize();
            const next = Math.max(60, Math.min(200, current + delta));
            renderer.setFontSize(next);
          }
        }}
        isBookmarked={isBookmarked(currentPage)}
        onBookmarkToggle={() => toggleBookmark(currentPage)}
        onExtract={handleExtract}
        onCloseSlot={() => (viewAPI as any).closeSelf()}
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
            key={bookId}
            renderer={renderer}
            currentChapter={epubProgress?.chapter}
            currentPage={currentPage}
            onNavigate={(position) => {
              if (position.type === 'page') {
                handlePageChange(position.page);
                gotoPage(position.page);
              } else if (position.type === 'cfi') {
                renderer.goTo(position);
              }
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
              onRegisterGotoPage={registerGotoPage}
            />
          )}

          {!loading && rendererReady && renderer && isReflowable(renderer) && (
            <ReflowableContent
              renderer={renderer}
              onPageChange={handlePageChange}
            />
          )}

          {/* EPUB 标注：文本选中后的颜色选择器 */}
          {epubSelection && (
            <div
              className="epub-annotation-picker"
              style={{
                position: 'absolute',
                left: Math.max(20, Math.min(epubSelection.x - 100, (contentRef.current?.clientWidth ?? 400) - 220)),
                top: epubSelection.y + 8,
                bottom: 'auto',
                transform: 'none',
              }}
            >
              <div className="epub-annotation-picker__colors">
                {EPUB_COLORS.map((c) => (
                  <button
                    key={c}
                    className="epub-annotation-picker__color"
                    style={{ backgroundColor: c }}
                    onClick={() => createAnnotation(c)}
                  />
                ))}
                <button
                  className="epub-annotation-picker__cancel"
                  onClick={dismissSelection}
                >✕</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
