/**
 * CDP Interceptor — Chrome DevTools Protocol 网络拦截
 *
 * 通过 webContents.debugger 附着 CDP，监听 Network 事件，
 * 捕获所有 HTTP 请求和响应体内容。
 *
 * 用途：
 * - Gemini：StreamGenerate 响应拦截（Zone.js 阻断 window.fetch hook）
 * - Claude Artifact：拦截 Artifact 生成/加载的网络请求，获取原始 SVG/代码
 * - 调试：查看页面的所有 API 调用，定位新的提取点
 *
 * 相比页面注入脚本（L2）：
 * - CDP 运行在 main 进程，不受 CSP、isolated world 限制
 * - 能获取 Service Worker 处理的请求（ChatGPT 的 conversation SSE）
 * - 能获取跨域 iframe 的请求（Claude Artifact sandbox）
 *
 * 设计文档：docs/web/WebBridge-设计.md §五 拦截能力
 */

export interface CDPRequest {
  requestId: string;
  url: string;
  method: string;
  timestamp: number;
  resourceType: string;
}

export interface CDPResponse {
  requestId: string;
  url: string;
  statusCode: number;
  mimeType: string;
  body: string | null;
  timestamp: number;
}

export interface CDPInterceptorConfig {
  /** URL 匹配过滤器 — 只记录匹配的请求（substring / regex） */
  urlFilters?: Array<string | RegExp>;
  /** 最大缓存请求数（FIFO） */
  maxCacheSize?: number;
  /** 是否自动读取响应体（默认 true；false 时只记录元信息） */
  captureBodies?: boolean;
  /** 每个请求完成时的回调 */
  onResponse?: (record: CDPResponse) => void;
}

/**
 * CDP 拦截器 — 单个 webContents 一个实例。
 *
 * Usage:
 *   const cdp = new CDPInterceptor(webContents, { urlFilters: [/api\./] });
 *   cdp.start();
 *   // ... 页面请求发生 ...
 *   const responses = cdp.getResponses();
 *   cdp.stop();
 */
export class CDPInterceptor {
  private attached = false;
  private pendingRequests = new Map<string, CDPRequest>();
  private responses: CDPResponse[] = [];
  private readonly maxCacheSize: number;
  private readonly urlFilters: Array<string | RegExp>;
  private readonly captureBodies: boolean;
  private readonly onResponse?: (record: CDPResponse) => void;

  constructor(
    private webContents: Electron.WebContents,
    config: CDPInterceptorConfig = {},
  ) {
    this.urlFilters = config.urlFilters ?? [];
    this.maxCacheSize = config.maxCacheSize ?? 100;
    this.captureBodies = config.captureBodies ?? true;
    this.onResponse = config.onResponse;
  }

  /**
   * 附着 CDP 调试器并开始监听网络事件。
   */
  start(): boolean {
    if (this.attached) return true;

    try {
      this.webContents.debugger.attach('1.3');
      this.attached = true;
      console.log('[CDPInterceptor] Debugger attached, webContents id =', this.webContents.id);
    } catch (err) {
      console.warn('[CDPInterceptor] Failed to attach debugger:', err);
      return false;
    }

    this.webContents.debugger.sendCommand('Network.enable').catch((err) => {
      console.warn('[CDPInterceptor] Network.enable failed:', err);
    });

    this.webContents.debugger.on('message', this.handleCDPMessage);
    this.webContents.debugger.on('detach', this.handleDetach);

    return true;
  }

  /**
   * 停止拦截并分离 CDP 调试器。
   */
  stop(): void {
    if (!this.attached) return;

    try {
      this.webContents.debugger.removeListener('message', this.handleCDPMessage);
      this.webContents.debugger.removeListener('detach', this.handleDetach);
      this.webContents.debugger.detach();
    } catch {
      /* already detached */
    }
    this.attached = false;
    console.log('[CDPInterceptor] Stopped');
  }

  /**
   * 获取所有已捕获的响应。
   */
  getResponses(): CDPResponse[] {
    return [...this.responses];
  }

  /**
   * 清空缓存。
   */
  clearResponses(): void {
    this.responses = [];
    this.pendingRequests.clear();
  }

  /**
   * 查询匹配 URL pattern 的最新响应。
   */
  findLatestResponse(urlPattern: string | RegExp): CDPResponse | null {
    for (let i = this.responses.length - 1; i >= 0; i--) {
      if (this.urlMatches(this.responses[i].url, urlPattern)) {
        return this.responses[i];
      }
    }
    return null;
  }

  /** 是否已附着 */
  isAttached(): boolean {
    return this.attached;
  }

  // ── 内部：处理 CDP 消息 ──

  private handleCDPMessage = (_event: Electron.Event, method: string, params: any) => {
    if (method === 'Network.requestWillBeSent') {
      this.onRequestWillBeSent(params);
    } else if (method === 'Network.loadingFinished') {
      this.onLoadingFinished(params);
    } else if (method === 'Network.loadingFailed') {
      this.onLoadingFailed(params);
    }
  };

  private handleDetach = () => {
    this.attached = false;
    console.log('[CDPInterceptor] Debugger detached');
  };

  private onRequestWillBeSent(params: any): void {
    const url = params.request?.url || '';
    if (!this.shouldCapture(url)) return;

    this.pendingRequests.set(params.requestId, {
      requestId: params.requestId,
      url,
      method: params.request?.method || 'GET',
      timestamp: Date.now(),
      resourceType: params.type || 'unknown',
    });
  }

  private onLoadingFinished(params: any): void {
    const req = this.pendingRequests.get(params.requestId);
    if (!req) return;
    this.pendingRequests.delete(params.requestId);

    if (!this.captureBodies) {
      const record: CDPResponse = {
        requestId: params.requestId,
        url: req.url,
        statusCode: 200,
        mimeType: '',
        body: null,
        timestamp: Date.now(),
      };
      this.pushResponse(record);
      return;
    }

    // Fetch response body via CDP
    this.webContents.debugger.sendCommand('Network.getResponseBody', {
      requestId: params.requestId,
    }).then((result: any) => {
      const body = result?.body ?? null;
      const record: CDPResponse = {
        requestId: params.requestId,
        url: req.url,
        statusCode: 200,
        mimeType: '',
        body,
        timestamp: Date.now(),
      };
      this.pushResponse(record);
    }).catch(() => {
      // Response body may not be available (e.g., redirect)
    });
  }

  private onLoadingFailed(params: any): void {
    this.pendingRequests.delete(params.requestId);
  }

  private pushResponse(record: CDPResponse): void {
    this.responses.push(record);
    while (this.responses.length > this.maxCacheSize) {
      this.responses.shift();
    }
    if (this.onResponse) {
      try {
        this.onResponse(record);
      } catch (err) {
        console.warn('[CDPInterceptor] onResponse callback error:', err);
      }
    }
  }

  private shouldCapture(url: string): boolean {
    if (this.urlFilters.length === 0) return true;
    for (const filter of this.urlFilters) {
      if (this.urlMatches(url, filter)) return true;
    }
    return false;
  }

  private urlMatches(url: string, pattern: string | RegExp): boolean {
    if (typeof pattern === 'string') return url.indexOf(pattern) !== -1;
    return pattern.test(url);
  }
}
