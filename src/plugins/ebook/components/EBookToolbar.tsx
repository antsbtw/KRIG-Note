import { useState, useCallback, KeyboardEvent } from 'react';
import { SlotToggle } from '../../../shared/components/SlotToggle';
import { OpenFilePopup } from '../../../shared/components/OpenFilePopup';
import type { FileItem } from '../../../shared/components/OpenFilePopup';

declare const viewAPI: {
  ebookBookshelfList: () => Promise<Array<{ id: string; displayName: string }>>;
  ebookBookshelfOpen: (id: string) => Promise<unknown>;
};

type AnnotationMode = 'off' | 'rect' | 'underline';

type RenderMode = 'fixed-page' | 'reflowable';

interface EBookToolbarProps {
  fileName: string;
  currentPage: number;
  pageCount: number;
  scale: number;
  fitWidth: boolean;
  annotationMode: AnnotationMode;
  sidebarOpen: boolean;
  renderMode: RenderMode;
  onPageChange: (page: number) => void;
  onScaleChange: (scale: number) => void;
  onFitWidthToggle: () => void;
  onAnnotationModeChange: (mode: AnnotationMode) => void;
  onSidebarToggle: () => void;
  epubProgress?: { chapter: string; percentage: number } | null;
  onPrevChapter?: () => void;
  onNextChapter?: () => void;
  onFontSizeChange?: (delta: number) => void;
  isBookmarked?: boolean;
  onBookmarkToggle?: () => void;
  onExtract?: () => void;
  onCloseSlot?: () => void;
  slotLocked?: boolean;
  onSlotLockToggle?: () => void;
}

const ZOOM_PRESETS = [
  { label: '50%', value: 0.5 },
  { label: '75%', value: 0.75 },
  { label: '100%', value: 1.0 },
  { label: '125%', value: 1.25 },
  { label: '150%', value: 1.5 },
  { label: '200%', value: 2.0 },
];

export function EBookToolbar({
  fileName,
  currentPage,
  pageCount,
  scale,
  fitWidth,
  annotationMode,
  sidebarOpen,
  onPageChange,
  onScaleChange,
  onFitWidthToggle,
  onAnnotationModeChange,
  onSidebarToggle,
  renderMode,
  epubProgress,
  onPrevChapter,
  onNextChapter,
  onFontSizeChange,
  isBookmarked,
  onBookmarkToggle,
  onExtract,
  onCloseSlot,
  slotLocked,
  onSlotLockToggle,
}: EBookToolbarProps) {
  const [pageInput, setPageInput] = useState('');
  const [editingPage, setEditingPage] = useState(false);

  const handlePrevPage = useCallback(() => {
    if (currentPage > 1) {
      onPageChange(currentPage - 1);
    }
  }, [currentPage, onPageChange]);

  const handleNextPage = useCallback(() => {
    if (currentPage < pageCount) {
      onPageChange(currentPage + 1);
    }
  }, [currentPage, pageCount, onPageChange]);

  const handlePageInputFocus = useCallback(() => {
    setPageInput(String(currentPage));
    setEditingPage(true);
  }, [currentPage]);

  const handlePageInputBlur = useCallback(() => {
    setEditingPage(false);
    const page = parseInt(pageInput, 10);
    if (!isNaN(page) && page >= 1 && page <= pageCount) {
      onPageChange(page);
    }
  }, [pageInput, pageCount, onPageChange]);

  const handlePageInputKey = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      setEditingPage(false);
      setPageInput('');
    }
  }, []);

  const handleZoomChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === 'fit-width') {
      onFitWidthToggle();
    } else {
      onScaleChange(parseFloat(val));
    }
  }, [onScaleChange, onFitWidthToggle]);

  const handleZoomIn = useCallback(() => {
    const next = Math.min(scale + 0.25, 3.0);
    onScaleChange(Math.round(next * 100) / 100);
  }, [scale, onScaleChange]);

  const handleZoomOut = useCallback(() => {
    const next = Math.max(scale - 0.25, 0.25);
    onScaleChange(Math.round(next * 100) / 100);
  }, [scale, onScaleChange]);

  const loadBookList = useCallback(async (): Promise<FileItem[]> => {
    const list = await viewAPI.ebookBookshelfList();
    return list.map((b: any) => ({ id: b.id, title: b.displayName || b.display_name || b.fileName || '' }));
  }, []);

  const handleOpenBook = useCallback((bookId: string) => {
    viewAPI.ebookBookshelfOpen(bookId);
  }, []);

  return (
    <div className="ebook-toolbar">
      {/* Left: sidebar + file name */}
      <div className="ebook-toolbar__section ebook-toolbar__section--left">
        {(pageCount > 0 || renderMode === 'reflowable') && (
          <button
            className={`ebook-toolbar__btn ${sidebarOpen ? 'ebook-toolbar__btn--active' : ''}`}
            onClick={onSidebarToggle}
            title="目录"
          >
            ☰
          </button>
        )}
        {fileName && (
          <span className="ebook-toolbar__filename">{fileName}</span>
        )}
      </div>

      {/* Center: navigation (mode-dependent) */}
      {renderMode === 'fixed-page' && pageCount > 0 && (
        <div className="ebook-toolbar__section ebook-toolbar__section--center">
          <button
            className="ebook-toolbar__btn"
            onClick={handlePrevPage}
            disabled={currentPage <= 1}
            title="Previous page"
          >
            ‹
          </button>
          <input
            className="ebook-toolbar__page-input"
            value={editingPage ? pageInput : String(currentPage)}
            onChange={(e) => setPageInput(e.target.value)}
            onFocus={handlePageInputFocus}
            onBlur={handlePageInputBlur}
            onKeyDown={handlePageInputKey}
          />
          <span className="ebook-toolbar__page-info">of {pageCount}</span>
          <button
            className="ebook-toolbar__btn"
            onClick={handleNextPage}
            disabled={currentPage >= pageCount}
            title="Next page"
          >
            ›
          </button>
        </div>
      )}

      {renderMode === 'reflowable' && (
        <div className="ebook-toolbar__section ebook-toolbar__section--center">
          <button className="ebook-toolbar__btn" onClick={onPrevChapter} title="上一页 (←)">‹</button>
          {epubProgress && (
            <span className="ebook-toolbar__epub-progress">
              {epubProgress.chapter || ''} · {Math.round(epubProgress.percentage * 100)}%
            </span>
          )}
          <button className="ebook-toolbar__btn" onClick={onNextChapter} title="下一页 (→)">›</button>
        </div>
      )}

      {/* Font size + bookmark (reflowable only) */}
      {renderMode === 'reflowable' && (
        <div className="ebook-toolbar__section ebook-toolbar__section--right">
          <button
            className={`ebook-toolbar__btn ${isBookmarked ? 'ebook-toolbar__btn--bookmark-active' : ''}`}
            onClick={onBookmarkToggle}
            title={isBookmarked ? '移除书签 (⌘D)' : '添加书签 (⌘D)'}
          >
            {isBookmarked ? '★' : '☆'}
          </button>
          <button className="ebook-toolbar__btn" onClick={() => onFontSizeChange?.(-10)} title="缩小">A−</button>
          <button className="ebook-toolbar__btn" onClick={() => onFontSizeChange?.(10)} title="放大">A+</button>
        </div>
      )}

      {/* Annotation mode + bookmark (fixed-page only) */}
      {renderMode === 'fixed-page' && pageCount > 0 && (
        <div className="ebook-toolbar__section ebook-toolbar__section--annotation">
          <button
            className={`ebook-toolbar__btn ${annotationMode === 'rect' ? 'ebook-toolbar__btn--active' : ''}`}
            onClick={() => onAnnotationModeChange(annotationMode === 'rect' ? 'off' : 'rect')}
            title="线框标注"
          >
            ▢
          </button>
          <button
            className={`ebook-toolbar__btn ${annotationMode === 'underline' ? 'ebook-toolbar__btn--active' : ''}`}
            onClick={() => onAnnotationModeChange(annotationMode === 'underline' ? 'off' : 'underline')}
            title="横线标注"
          >
            ▁
          </button>
          <button
            className={`ebook-toolbar__btn ${isBookmarked ? 'ebook-toolbar__btn--bookmark-active' : ''}`}
            onClick={onBookmarkToggle}
            title={isBookmarked ? '移除书签 (⌘D)' : '添加书签 (⌘D)'}
          >
            {isBookmarked ? '★' : '☆'}
          </button>
          {onExtract && (
            <button
              className="ebook-toolbar__btn"
              onClick={onExtract}
              title="提取到 Note (上传 PDF 到 Platform)"
            >
              📤
            </button>
          )}
        </div>
      )}

      {/* Right: zoom controls (fixed-page only) */}
      {renderMode === 'fixed-page' && pageCount > 0 && (
        <div className="ebook-toolbar__section ebook-toolbar__section--right">
          <button className="ebook-toolbar__btn" onClick={handleZoomOut} title="Zoom out">
            −
          </button>
          <select
            className="ebook-toolbar__zoom-select"
            value={fitWidth ? 'fit-width' : scale}
            onChange={handleZoomChange}
          >
            <option value="fit-width">适应宽度</option>
            {ZOOM_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
            {!fitWidth && !ZOOM_PRESETS.some((p) => p.value === scale) && (
              <option value={scale}>{Math.round(scale * 100)}%</option>
            )}
          </select>
          <button className="ebook-toolbar__btn" onClick={handleZoomIn} title="Zoom in">
            +
          </button>
        </div>
      )}

      {/* Open + SlotToggle + Close slot */}
      <div className="ebook-toolbar__section ebook-toolbar__section--close" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <OpenFilePopup
          label="Open"
          placeholder="搜索书籍..."
          loadItems={loadBookList}
          onSelect={handleOpenBook}
        />
        {onSlotLockToggle && (
          <button
            className={`ebook-toolbar__btn ${slotLocked ? 'ebook-toolbar__btn--active' : ''}`}
            onClick={onSlotLockToggle}
            title={slotLocked ? '已锁定位置：两侧独立滚动（点击恢复联动）' : '联动中：left 滚动时 right 跟随（点击锁定）'}
          >
            🔄
          </button>
        )}
        <SlotToggle />
        {onCloseSlot && (
          <button className="ebook-toolbar__btn ebook-toolbar__btn--close-slot" onClick={onCloseSlot} title="关闭此面板">
            ×
          </button>
        )}
      </div>
    </div>
  );
}
