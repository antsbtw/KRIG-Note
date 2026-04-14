import { WebContents } from 'electron';

/**
 * Extraction 下载拦截器
 *
 * 在 Platform WebView 中注入 JS 脚本，拦截 JSON 文件下载行为：
 * 1. 覆盖 <a> download + click，读取 blob → JSON 字符串
 * 2. 通过 console.log('KRIG_IMPORT:' + JSON) 发送给 KRIG-Note
 * 3. ExtractionView 的 console-message 监听 → viewAPI.extractionImport()
 *    → IPC EXTRACTION_IMPORT handler → importExtractionData()
 *
 * 这比 will-download 拦截可靠：不丢失、不乱序、确定性传输。
 */

/** 注入到 Platform WebView 中拦截下载的 JS 脚本 */
const DOWNLOAD_INTERCEPT_SCRIPT = `
(function() {
  if (window.__krigDownloadInterceptInstalled) return;
  window.__krigDownloadInterceptInstalled = true;

  // 收集同一轮操作中的所有文件
  const pendingFiles = [];
  let flushTimer = null;
  const FLUSH_DELAY = 1500; // 最后一个文件读取完成后等 1.5 秒

  function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      if (pendingFiles.length === 0) return;
      const batch = pendingFiles.splice(0);
      // 按 pageStart 排序
      batch.sort((a, b) => a.pageStart - b.pageStart);
      // 发送批次
      console.log('KRIG_IMPORT:' + JSON.stringify({
        type: 'batch',
        chapters: batch
      }));
    }, FLUSH_DELAY);
  }

  // 从文件名解析元数据
  function parseFileName(fileName) {
    let name = fileName.replace(/\\.json$/, '');
    let pageStart = 0, pageEnd = 0;
    const pageMatch = name.match(/_p(\\d+)-(\\d+)$/);
    if (pageMatch) {
      pageStart = parseInt(pageMatch[1], 10);
      pageEnd = parseInt(pageMatch[2], 10);
      name = name.slice(0, -pageMatch[0].length);
    }
    let bookName = name, chapterTitle = '';
    const pdfSep = name.indexOf('.pdf_');
    if (pdfSep >= 0) {
      bookName = name.slice(0, pdfSep);
      chapterTitle = name.slice(pdfSep + '.pdf_'.length);
      chapterTitle = chapterTitle.replace(/／\\d+$/, '');
      chapterTitle = chapterTitle.replace(/_/g, ' ');
    } else {
      bookName = bookName.replace(/\\.pdf$/, '');
    }
    return { bookName, chapterTitle, pageStart, pageEnd };
  }

  // 拦截 <a> 元素的点击下载
  const origCreateElement = document.createElement.bind(document);
  document.createElement = function(tagName, options) {
    const el = origCreateElement(tagName, options);
    if (tagName.toLowerCase() === 'a') {
      const origClick = el.click.bind(el);
      el.click = function() {
        // 检查是否是 JSON 下载
        const href = el.href || '';
        const download = el.download || '';
        if (download.endsWith('.json') && href.startsWith('blob:')) {
          // 拦截：读取 blob 内容
          fetch(href)
            .then(r => r.text())
            .then(text => {
              const parsed = parseFileName(download);
              try {
                const data = JSON.parse(text);
                pendingFiles.push({
                  fileName: download,
                  bookName: data.bookName || parsed.bookName,
                  title: parsed.chapterTitle || parsed.bookName,
                  pageStart: parsed.pageStart,
                  pageEnd: parsed.pageEnd,
                  pages: data.pages || [],
                });
                console.log('[KRIG Bridge] Captured: ' + download);
                scheduleFlush();
              } catch (e) {
                console.error('[KRIG Bridge] JSON parse failed:', download, e);
              }
              // 释放 blob URL
              URL.revokeObjectURL(href);
            })
            .catch(err => {
              console.error('[KRIG Bridge] Fetch failed:', href, err);
              origClick();
            });
          return;
        }
        origClick();
      };
    }
    return el;
  };

  console.log('[KRIG Bridge] Download intercept installed');
})();
`;

export function setupExtractionInterceptor(guestWebContents: WebContents): void {
  // 每次页面加载完成后注入拦截脚本
  guestWebContents.on('did-finish-load', () => {
    guestWebContents.executeJavaScript(DOWNLOAD_INTERCEPT_SCRIPT).catch(err => {
      console.error('[Extraction] Failed to inject intercept script:', err);
    });
  });

  // 同时在 did-navigate-in-page 时也注入（SPA 路由切换）
  guestWebContents.on('did-navigate-in-page', () => {
    guestWebContents.executeJavaScript(DOWNLOAD_INTERCEPT_SCRIPT).catch(() => {});
  });
}

/**
 * 从文件名中解析书名、章节名、页码范围（主进程侧使用）
 */
export function parseExtractionFileName(fileName: string): {
  bookName: string;
  chapterTitle: string;
  pageStart: number;
  pageEnd: number;
} {
  let name = fileName.replace(/\.json$/, '');

  let pageStart = 0;
  let pageEnd = 0;
  const pageMatch = name.match(/_p(\d+)-(\d+)$/);
  if (pageMatch) {
    pageStart = parseInt(pageMatch[1], 10);
    pageEnd = parseInt(pageMatch[2], 10);
    name = name.slice(0, -pageMatch[0].length);
  }

  let bookName = name;
  let chapterTitle = '';
  const pdfSep = name.indexOf('.pdf_');
  if (pdfSep >= 0) {
    bookName = name.slice(0, pdfSep);
    chapterTitle = name.slice(pdfSep + '.pdf_'.length);
    chapterTitle = chapterTitle.replace(/／\d+$/, '');
    chapterTitle = chapterTitle.replace(/_/g, ' ');
  } else {
    bookName = bookName.replace(/\.pdf$/, '');
  }

  return { bookName, chapterTitle, pageStart, pageEnd };
}
