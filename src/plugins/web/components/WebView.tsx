import { useState, useRef, useCallback, useEffect } from 'react';
import { WebToolbar } from './WebToolbar';
import '../web.css';

declare const viewAPI: {
  webBookmarkAdd: (url: string, title: string, favicon?: string) => Promise<unknown>;
  webBookmarkRemove: (id: string) => Promise<void>;
  webBookmarkList: () => Promise<Array<{ id: string; url: string; title: string; favicon?: string; folderId: string | null; createdAt: number }>>;
  webBookmarkFindByUrl: (url: string) => Promise<{ id: string } | null>;
  webHistoryAdd: (url: string, title: string, favicon?: string) => Promise<unknown>;
};

const DEFAULT_URL = 'https://www.google.com';

/**
 * WebView — L3 View 组件
 *
 * 内部结构：Toolbar + webview 标签。
 * webview 标签是 Electron 提供的独立渲染进程容器。
 */
export function WebView() {
  const webviewRef = useRef<Electron.WebviewTag | null>(null);
  const [currentUrl, setCurrentUrl] = useState(DEFAULT_URL);
  const [currentTitle, setCurrentTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const bookmarkIdRef = useRef<string | null>(null);

  // ── webview 事件绑定 ──

  const setupWebview = useCallback((el: Electron.WebviewTag | null) => {
    if (!el || webviewRef.current === el) return;
    webviewRef.current = el;

    el.addEventListener('did-start-loading', () => setLoading(true));
    el.addEventListener('did-stop-loading', () => setLoading(false));

    el.addEventListener('did-navigate', (e: any) => {
      setCurrentUrl(e.url);
      setCanGoBack(el.canGoBack());
      setCanGoForward(el.canGoForward());
      checkBookmark(e.url);
    });

    el.addEventListener('did-navigate-in-page', (e: any) => {
      if (e.isMainFrame) {
        setCurrentUrl(e.url);
        setCanGoBack(el.canGoBack());
        setCanGoForward(el.canGoForward());
        checkBookmark(e.url);
      }
    });

    el.addEventListener('page-title-updated', (e: any) => {
      setCurrentTitle(e.title);
      // 记录浏览历史
      const url = el.getURL();
      if (url && !url.startsWith('about:') && e.title) {
        viewAPI.webHistoryAdd(url, e.title).catch(() => {});
      }
    });

  }, []);

  // ── 书签状态检查 ──

  const checkBookmark = useCallback(async (url: string) => {
    try {
      const found = await viewAPI.webBookmarkFindByUrl(url);
      setIsBookmarked(!!found);
      bookmarkIdRef.current = found?.id ?? null;
    } catch {
      setIsBookmarked(false);
      bookmarkIdRef.current = null;
    }
  }, []);

  // 初始加载时检查
  useEffect(() => {
    checkBookmark(currentUrl);
  }, []);

  // ── Toolbar 回调 ──

  const handleNavigate = useCallback((url: string) => {
    const webview = webviewRef.current;
    if (!webview) return;

    let finalUrl = url.trim();
    if (!finalUrl) return;

    // 非 URL → Google 搜索
    if (!finalUrl.includes('://') && !finalUrl.includes('.')) {
      finalUrl = `https://www.google.com/search?q=${encodeURIComponent(finalUrl)}`;
    } else if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      finalUrl = `https://${finalUrl}`;
    }

    webview.loadURL(finalUrl);
  }, []);

  const handleGoBack = useCallback(() => webviewRef.current?.goBack(), []);
  const handleGoForward = useCallback(() => webviewRef.current?.goForward(), []);
  const handleReload = useCallback(() => webviewRef.current?.reload(), []);

  const handleBookmarkToggle = useCallback(async () => {
    if (isBookmarked && bookmarkIdRef.current) {
      await viewAPI.webBookmarkRemove(bookmarkIdRef.current);
      setIsBookmarked(false);
      bookmarkIdRef.current = null;
    } else {
      const result = await viewAPI.webBookmarkAdd(currentUrl, currentTitle || currentUrl) as any;
      setIsBookmarked(true);
      bookmarkIdRef.current = result?.id ?? null;
    }
  }, [isBookmarked, currentUrl, currentTitle]);

  return (
    <div className="web-view">
      <WebToolbar
        url={currentUrl}
        loading={loading}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        isBookmarked={isBookmarked}
        onNavigate={handleNavigate}
        onGoBack={handleGoBack}
        onGoForward={handleGoForward}
        onReload={handleReload}
        onBookmarkToggle={handleBookmarkToggle}
      />
      <div className="web-view__content">
        <webview
          ref={setupWebview}
          src={DEFAULT_URL}
          className="web-view__webview"
          partition="persist:web"
          allowpopups={'true' as any}
        />
      </div>
    </div>
  );
}
