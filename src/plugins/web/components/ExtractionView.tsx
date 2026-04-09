import { useState, useRef, useCallback, useEffect } from 'react';
import '../web.css';

declare const viewAPI: {
  onExtractionNavigate: (callback: (md5: string) => void) => () => void;
  onExtractionImport: (callback: (data: unknown) => void) => () => void;
  extractionImport: (data: unknown) => Promise<void>;
};

/**
 * KRIG Knowledge Platform 的 URL
 * TODO: 从配置中读取，而非硬编码
 */
const PLATFORM_URL = 'http://192.168.1.240:8091';

/**
 * ExtractionView — WebView extraction 变种
 *
 * 嵌入 KRIG Knowledge Platform 的 Web UI 到 Right Slot。
 * Platform Web UI 负责所有操作：登录、上传 PDF、提取、进度、下载。
 * KRIG-Note 前端只负责：
 * 1. 嵌入 Platform Web UI
 * 2. 拦截下载 → Atom JSON → 创建 Note
 */
export function ExtractionView() {
  const webviewRef = useRef<Electron.WebviewTag | null>(null);
  const [currentUrl, setCurrentUrl] = useState(PLATFORM_URL);
  const [loading, setLoading] = useState(false);
  const [pageTitle, setPageTitle] = useState('PDF Extraction');

  const setupWebview = useCallback((el: Electron.WebviewTag | null) => {
    if (!el || webviewRef.current === el) return;
    webviewRef.current = el;

    el.addEventListener('did-start-loading', () => setLoading(true));
    el.addEventListener('did-stop-loading', () => setLoading(false));
    el.addEventListener('did-navigate', (e: any) => setCurrentUrl(e.url));
    el.addEventListener('page-title-updated', (e: any) => setPageTitle(e.title || 'PDF Extraction'));

    // 拦截 Platform "导入到 KRIG" 操作
    // Platform Web UI 通过 console.log('KRIG_IMPORT:' + JSON.stringify(data)) 发送导入请求
    el.addEventListener('console-message', async (e: any) => {
      const msg = e.message as string;
      if (msg.startsWith('KRIG_IMPORT:')) {
        try {
          const data = JSON.parse(msg.slice('KRIG_IMPORT:'.length));
          await handleImport(data);
        } catch (err) {
          console.error('[ExtractionView] Import failed:', err);
        }
      }
    });
  }, []);

  // ── 导入 Atom JSON → 发给主进程处理 ──

  const handleImport = useCallback(async (data: any) => {
    console.log('[ExtractionView] Sending import data to main process...');
    await viewAPI.extractionImport(data);
  }, []);

  // 上传完成后，主进程发送 md5 → 自动导航到书籍详情页
  useEffect(() => {
    const unsub = viewAPI.onExtractionNavigate((md5) => {
      const webview = webviewRef.current;
      if (webview) {
        webview.loadURL(`${PLATFORM_URL}/book/${md5}`);
      }
    });
    return unsub;
  }, []);

  // 主进程拦截 JSON 下载后发送数据 → 创建 Note
  useEffect(() => {
    const unsub = viewAPI.onExtractionImport((data: any) => {
      console.log('[ExtractionView] Received import data:', JSON.stringify(data).slice(0, 500));
      // 适配 Platform 的 JSON 格式
      // Platform 可能返回：{ pages: [...] } 或 { tasks: [...] } 或直接是 Atom[]
      // 先打印看格式，再做转换
      if (data && typeof data === 'object') {
        const keys = Object.keys(data);
        console.log('[ExtractionView] Data keys:', keys);
      }
      handleImport(data);
    });
    return unsub;
  }, [handleImport]);

  return (
    <div className="web-view">
      <div className="extraction-toolbar">
        <span className="extraction-toolbar__title">
          {loading ? '⏳' : '📤'} {pageTitle}
        </span>
        <span className="extraction-toolbar__url">{currentUrl}</span>
        <span style={{ flex: 1 }} />
        <button className="extraction-toolbar__close" onClick={() => (window as any).viewAPI.closeSlot()} title="关闭此面板">
          ×
        </button>
      </div>
      <div className="web-view__content">
        <webview
          ref={setupWebview}
          src={PLATFORM_URL}
          className="web-view__webview"
          partition="persist:extraction"
          allowpopups={'true' as any}
        />
      </div>
    </div>
  );
}

