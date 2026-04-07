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
  onEbookLoaded: (callback: (info: { fileName: string; fileType: string }) => void) => () => void;
};

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
  const [rendererReady, setRendererReady] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);

  // 监听 EBOOK_LOADED 事件（由 NavSide 或 Menu 触发）
  useEffect(() => {
    const unsub = viewAPI.onEbookLoaded(async (info) => {
      try {
        setLoading(true);
        setFileName(info.fileName);

        const result = await viewAPI.ebookGetData();
        if (!result) { setLoading(false); return; }

        // 销毁旧渲染器
        rendererRef.current?.destroy();

        // 根据文件格式创建渲染引擎
        const fileType = (info.fileType || detectFileType(result.fileName)) as EBookFileType;
        const renderer = createRenderer(fileType);
        await renderer.load(result.data);

        rendererRef.current = renderer;

        if (isFixedPage(renderer)) {
          setPageCount(renderer.getTotalPages());
          setScale(renderer.getScale());
        } else {
          setPageCount(0);
          setScale(1.0);
        }

        setCurrentPage(1);
        setRendererReady(true);
        setLoading(false);
      } catch (err) {
        console.error('[EBookView] Failed to load:', err);
        setLoading(false);
      }
    });
    return unsub;
  }, []);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  const handleScaleChange = useCallback((newScale: number) => {
    setScale(newScale);
    const renderer = rendererRef.current;
    if (renderer && isFixedPage(renderer)) {
      renderer.setScale(newScale);
    }
  }, []);

  const renderer = rendererRef.current;

  return (
    <div className="ebook-view">
      <EBookToolbar
        fileName={fileName}
        currentPage={currentPage}
        pageCount={pageCount}
        scale={scale}
        onPageChange={handlePageChange}
        onScaleChange={handleScaleChange}
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
