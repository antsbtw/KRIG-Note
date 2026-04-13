import { useState, useRef, useCallback, useEffect } from 'react';
import { getSSECaptureScript } from '../../../shared/ai/sse-capture-script';
import { getDomToMarkdownScript } from '../../../shared/ai/dom-to-markdown';
import { getAIServiceProfile, getAIServiceList, DEFAULT_AI_SERVICE, detectAIServiceByUrl } from '../../../shared/types/ai-service-types';
import type { AIServiceId } from '../../../shared/types/ai-service-types';
import '../web.css';

declare const viewAPI: {
  sendToOtherSlot: (message: { protocol: string; action: string; payload: unknown }) => void;
  onMessage: (callback: (message: { protocol: string; action: string; payload: unknown }) => void) => () => void;
  onAIInjectAndSend?: (callback: (params: any) => void) => () => void;
  aiSendResponse?: (channel: string, result: any) => Promise<void>;
  aiExtractDebug: (params: { markdown: string; serviceId: string }) =>
    Promise<{ success: boolean; atomCount?: number; blocks?: number; error?: string; preview?: string; blockTypes?: string[]; atomTypes?: string[]; blockDetails?: any[]; atomDetails?: any[] }>;
  closeSlot: () => void;
};

/**
 * AIWebView — AI 专用 WebView 变体
 *
 * 与普通 WebView 的区别：
 * - 无地址栏输入（AI 服务 URL 固定）
 * - 简化 toolbar（服务名 + 状态 + 关闭）
 * - 支持 AI_INJECT_AND_SEND IPC 消息
 * - 保持 AI 页面的登录状态和对话历史
 */
export function AIWebView() {
  const webviewRef = useRef<Electron.WebviewTag | null>(null);
  const [currentService, setCurrentService] = useState<AIServiceId>(DEFAULT_AI_SERVICE);
  const [currentUrl, setCurrentUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [showServiceMenu, setShowServiceMenu] = useState(false);
  const [aiStatus, setAiStatus] = useState<'idle' | 'injecting' | 'waiting' | 'capturing'>('idle');
  const [extractResult, setExtractResult] = useState<string | null>(null);
  const [extractDetail, setExtractDetail] = useState<{
    markdown: string; blocks: string[]; atoms: string[]; preview: string;
    blockDetails?: any[]; atomDetails?: any[];
  } | null>(null);
  const [showExtractDetail, setShowExtractDetail] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const initialUrl = getAIServiceProfile(DEFAULT_AI_SERVICE).newChatUrl;

  // ── webview 事件绑定 ──
  const setupWebview = useCallback((el: Electron.WebviewTag | null) => {
    if (!el || webviewRef.current === el) return;
    webviewRef.current = el;

    el.addEventListener('did-start-loading', () => setLoading(true));
    el.addEventListener('did-stop-loading', () => setLoading(false));
    el.addEventListener('did-navigate', (_e: any) => {
      setCurrentUrl(el.getURL());
      const detected = detectAIServiceByUrl(el.getURL());
      if (detected) setCurrentService(detected.id);
    });
    el.addEventListener('did-navigate-in-page', () => {
      setCurrentUrl(el.getURL());
    });

    setCurrentUrl(initialUrl);
  }, [initialUrl]);

  // ── 切换 AI 服务 ──
  const switchService = useCallback((serviceId: AIServiceId) => {
    const webview = webviewRef.current;
    if (!webview) return;
    const profile = getAIServiceProfile(serviceId);
    webview.loadURL(profile.newChatUrl);
    setCurrentService(serviceId);
    setCurrentUrl(profile.newChatUrl);
    setShowServiceMenu(false);
  }, []);

  // ── 提取最新 AI 回复 ──
  // 策略：SSE（原始 Markdown）+ DOM（补充图片/图表/Artifacts）互补
  const handleExtractLatest = useCallback(async () => {
    const webview = webviewRef.current;
    if (!webview) {
      setExtractResult('✗ Webview not ready');
      return;
    }

    try {
      setExtractResult('提取中...');
      const profile = getAIServiceProfile(currentService);

      // ── Step 1: SSE 缓存（原始 Markdown，格式最准确）──
      const sseScript = getSSECaptureScript(profile.id, profile.intercept.endpointPattern);
      await webview.executeJavaScript(sseScript);

      const sseMarkdown: string | null = await webview.executeJavaScript(`(function() {
        var r = window.__krig_sse_responses || [];
        for (var i = r.length - 1; i >= 0; i--) {
          if (!r[i].streaming && r[i].markdown.length > 0) return r[i].markdown;
        }
        return null;
      })()`);

      // ── Step 2: DOM 提取（最后一个 assistant message → Markdown）──
      // 注入 domToMarkdown 函数
      const domScript = getDomToMarkdownScript();
      await webview.executeJavaScript(domScript);

      const domMarkdown: string | null = await webview.executeJavaScript(`(function() {
        if (typeof domToMarkdown !== 'function') return null;
        var selector = ${JSON.stringify(profile.selectors.assistantMessage)};
        var selectors = selector.split(',').map(function(s) { return s.trim(); });
        var all = [];
        for (var i = 0; i < selectors.length; i++) {
          var nodes = document.querySelectorAll(selectors[i]);
          for (var j = 0; j < nodes.length; j++) all.push(nodes[j]);
        }
        if (all.length === 0) return null;
        var last = all[all.length - 1];
        return domToMarkdown(last);
      })()`);

      // ── Step 3: 合并策略 ──
      // SSE 有原始 Markdown（公式/代码格式完美），DOM 有渲染后内容（含图片/图表）
      let finalMarkdown = '';
      let source = '';

      if (sseMarkdown && domMarkdown) {
        // 两者都有 — SSE 为主，DOM 补充 SSE 中缺失的图片
        finalMarkdown = sseMarkdown;
        source = 'SSE+DOM';

        // 从 DOM 中提取 SSE 中没有的图片 URL
        const sseImageUrls = new Set(
          (sseMarkdown.match(/!\[([^\]]*)\]\(([^)]+)\)/g) || [])
            .map(m => m.match(/\(([^)]+)\)/)?.[1]).filter(Boolean)
        );
        const domImages = (domMarkdown.match(/!\[([^\]]*)\]\(([^)]+)\)/g) || [])
          .filter(m => {
            const url = m.match(/\(([^)]+)\)/)?.[1];
            return url && !sseImageUrls.has(url);
          });

        if (domImages.length > 0) {
          finalMarkdown += '\n\n' + domImages.join('\n\n');
          source = `SSE(${sseMarkdown.length})+DOM(+${domImages.length} images)`;
        } else {
          source = `SSE(${sseMarkdown.length}), DOM(${domMarkdown.length}) no extra images`;
        }
      } else if (sseMarkdown) {
        finalMarkdown = sseMarkdown;
        source = `SSE only (${sseMarkdown.length} chars)`;
      } else if (domMarkdown) {
        finalMarkdown = domMarkdown;
        source = `DOM only (${domMarkdown.length} chars)`;
      } else {
        setExtractResult('✗ SSE 和 DOM 均无数据');
        return;
      }

      console.log(`[AIWebView Extract] Source: ${source}`);
      console.log(`[AIWebView Extract] Final markdown: ${finalMarkdown.length} chars`);

      // ── Step 4: 发送到 main 解析 ──
      const result = await viewAPI.aiExtractDebug({
        markdown: finalMarkdown,
        serviceId: currentService,
      });

      if (result.success) {
        setExtractResult(`✓ ${result.blocks} blocks → ${result.atomCount} atoms [${source}]`);
        setExtractDetail({
          markdown: finalMarkdown,
          blocks: result.blockTypes || [],
          atoms: result.atomTypes || [],
          preview: result.preview || '',
          blockDetails: result.blockDetails,
          atomDetails: result.atomDetails,
        });
        setShowExtractDetail(true);
      } else {
        setExtractResult(`✗ ${result.error}`);
        setExtractDetail(null);
      }
    } catch (err) {
      setExtractResult(`✗ ${String(err)}`);
      console.error('[AIWebView Extract] Error:', err);
    }
  }, [currentService]);

  // ── 点击外部关闭菜单 ──
  useEffect(() => {
    if (!showServiceMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowServiceMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showServiceMenu]);

  // ── AI Workflow: handle AI_INJECT_AND_SEND ──
  useEffect(() => {
    const unsub = viewAPI.onAIInjectAndSend?.(async (params: {
      serviceId: string; prompt: string; noteId: string; thoughtId: string; responseChannel: string;
    }) => {
      let webview = webviewRef.current;
      // Wait for webview to be ready
      for (let i = 0; i < 10 && !webview; i++) {
        await new Promise(r => setTimeout(r, 300));
        webview = webviewRef.current;
      }
      if (!webview) {
        viewAPI.aiSendResponse?.(params.responseChannel, { success: false, error: 'AI Webview not ready' });
        return;
      }

      try {
        const profile = getAIServiceProfile(params.serviceId as AIServiceId);

        // 1. Navigate to AI service if not already there
        const curUrl = webview.getURL?.() || '';
        if (!new RegExp(profile.urlPattern).test(curUrl)) {
          setAiStatus('injecting');
          console.log(`[AIWebView] Navigating to ${profile.newChatUrl}`);
          webview.loadURL(profile.newChatUrl);
          setCurrentService(params.serviceId as AIServiceId);

          await new Promise<void>((resolve) => {
            const onLoad = () => { webview!.removeEventListener('did-finish-load', onLoad); resolve(); };
            webview!.addEventListener('did-finish-load', onLoad);
          });
          // SPA hydration
          await new Promise(r => setTimeout(r, 3000));
        }

        // 2. Inject SSE capture
        setAiStatus('injecting');
        const sseScript = getSSECaptureScript(profile.id, profile.intercept.endpointPattern);
        const hookResult = await webview.executeJavaScript(sseScript);
        console.log(`[AIWebView] SSE hook: ${hookResult}`);
        await webview.executeJavaScript('window.__krig_sse_responses = [];');

        // 3. Paste prompt
        const escaped = params.prompt.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
        await webview.executeJavaScript(`(function() {
          var selector = ${JSON.stringify(profile.selectors.inputBox)};
          var selectors = selector.split(',').map(function(s) { return s.trim(); });
          var el = null;
          for (var i = 0; i < selectors.length; i++) { el = document.querySelector(selectors[i]); if (el) break; }
          if (!el) return;
          el.focus();
          if (el.contentEditable === 'true') {
            var dt = new DataTransfer();
            dt.setData('text/plain', \`${escaped}\`);
            el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
            setTimeout(function() {
              if (el.textContent.trim().length === 0) {
                el.innerHTML = '<p>' + \`${escaped}\`.replace(/\\n/g, '</p><p>') + '</p>';
                el.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }, 200);
          } else {
            el.value = \`${escaped}\`;
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        })()`);

        // 4. Click send
        await new Promise(r => setTimeout(r, 500));
        await webview.executeJavaScript(`(function() {
          var selector = ${JSON.stringify(profile.selectors.sendButton)};
          var selectors = selector.split(',').map(function(s) { return s.trim(); });
          var btn = null;
          for (var i = 0; i < selectors.length; i++) { btn = document.querySelector(selectors[i]); if (btn && !btn.disabled) break; btn = null; }
          if (btn) btn.click();
        })()`);

        // 5. Poll for response
        setAiStatus('waiting');
        console.log(`[AIWebView] Waiting for AI response...`);
        const startTime = Date.now();
        while (Date.now() - startTime < 90_000) {
          await new Promise(r => setTimeout(r, 1000));
          const status = await webview.executeJavaScript(`(function() {
            var r = window.__krig_sse_responses || [];
            var l = r.length > 0 ? r[r.length - 1] : null;
            return { count: r.length, streaming: l ? l.streaming : false, hooked: !!window.__krig_sse_hooked };
          })()`);

          const elapsed = Math.round((Date.now() - startTime) / 1000);
          if (elapsed % 5 === 0) {
            console.log(`[AIWebView] Poll ${elapsed}s: responses=${status.count}, streaming=${status.streaming}, hooked=${status.hooked}`);
          }

          if (status.count > 0 && !status.streaming) {
            setAiStatus('capturing');

            // SSE markdown
            const sseMarkdown = await webview.executeJavaScript(`(function() {
              var r = window.__krig_sse_responses || [];
              for (var i = r.length - 1; i >= 0; i--) { if (!r[i].streaming && r[i].markdown.length > 0) return r[i].markdown; }
              return null;
            })()`);

            // DOM markdown (complement — captures images/artifacts SSE misses)
            const domScript2 = getDomToMarkdownScript();
            await webview.executeJavaScript(domScript2);
            const domMd = await webview.executeJavaScript(`(function() {
              if (typeof domToMarkdown !== 'function') return null;
              var selector = ${JSON.stringify(profile.selectors.assistantMessage)};
              var selectors = selector.split(',').map(function(s) { return s.trim(); });
              var all = [];
              for (var i = 0; i < selectors.length; i++) {
                var nodes = document.querySelectorAll(selectors[i]);
                for (var j = 0; j < nodes.length; j++) all.push(nodes[j]);
              }
              if (all.length === 0) return null;
              return domToMarkdown(all[all.length - 1]);
            })()`);

            // Merge: SSE + DOM images
            let finalMd = sseMarkdown || domMd || '';
            if (sseMarkdown && domMd) {
              const sseImgs = new Set((sseMarkdown.match(/!\[([^\]]*)\]\(([^)]+)\)/g) || []).map((m: string) => m.match(/\(([^)]+)\)/)?.[1]).filter(Boolean));
              const extraImgs = (domMd.match(/!\[([^\]]*)\]\(([^)]+)\)/g) || []).filter((m: string) => { const u = m.match(/\(([^)]+)\)/)?.[1]; return u && !sseImgs.has(u); });
              if (extraImgs.length > 0) finalMd += '\n\n' + extraImgs.join('\n\n');
            }

            console.log(`[AIWebView] Captured: SSE=${sseMarkdown?.length ?? 0}, DOM=${domMd?.length ?? 0}, final=${finalMd.length}`);
            setAiStatus('idle');
            viewAPI.aiSendResponse?.(params.responseChannel, { success: true, markdown: finalMd });
            return;
          }
        }
        // Timeout — try DOM extraction as last resort
        setAiStatus('capturing');
        const domScript3 = getDomToMarkdownScript();
        await webview.executeJavaScript(domScript3);
        const timeoutDomMd = await webview.executeJavaScript(`(function() {
          if (typeof domToMarkdown !== 'function') return null;
          var selector = ${JSON.stringify(profile.selectors.assistantMessage)};
          var selectors = selector.split(',').map(function(s) { return s.trim(); });
          var all = [];
          for (var i = 0; i < selectors.length; i++) {
            var nodes = document.querySelectorAll(selectors[i]);
            for (var j = 0; j < nodes.length; j++) all.push(nodes[j]);
          }
          if (all.length === 0) return null;
          return domToMarkdown(all[all.length - 1]);
        })()`);
        setAiStatus('idle');
        if (timeoutDomMd) {
          console.log(`[AIWebView] SSE timeout but DOM extracted: ${timeoutDomMd.length} chars`);
          viewAPI.aiSendResponse?.(params.responseChannel, { success: true, markdown: timeoutDomMd });
        } else {
          viewAPI.aiSendResponse?.(params.responseChannel, { success: false, error: 'AI response timed out (SSE + DOM both empty)' });
        }
      } catch (err) {
        setAiStatus('idle');
        console.error('[AIWebView] Error:', err);
        viewAPI.aiSendResponse?.(params.responseChannel, { success: false, error: String(err) });
      }
    });

    return () => { if (unsub) unsub(); };
  }, []);

  const services = getAIServiceList();
  const currentProfile = getAIServiceProfile(currentService);

  const statusText = aiStatus === 'idle' ? '' :
    aiStatus === 'injecting' ? '注入中...' :
    aiStatus === 'waiting' ? 'AI 回复中...' :
    '提取中...';

  return (
    <div className="web-view">
      {/* AI Toolbar — 简化版，无地址栏 */}
      <div className="web-toolbar" style={{ display: 'flex', alignItems: 'center', padding: '4px 8px', gap: 8 }}>
        {/* Service selector */}
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            style={{
              background: '#333', border: '1px solid #555', borderRadius: 6,
              color: '#e8eaed', fontSize: 13, padding: '4px 12px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
            onClick={() => setShowServiceMenu(!showServiceMenu)}
          >
            <span>{currentProfile.icon}</span>
            <span>{currentProfile.name}</span>
            <span style={{ fontSize: 10, color: '#888' }}>▾</span>
          </button>
          {showServiceMenu && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 4,
              background: '#2a2a2a', border: '1px solid #444', borderRadius: 8,
              padding: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.4)', minWidth: 130, zIndex: 1000,
            }}>
              {services.map(s => (
                <button
                  key={s.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    padding: '6px 12px', background: s.id === currentService ? '#3a3a3a' : 'transparent',
                    border: 'none', color: '#e8eaed', fontSize: 13, cursor: 'pointer', borderRadius: 4,
                  }}
                  onClick={() => switchService(s.id as AIServiceId)}
                >
                  <span>{s.icon}</span> {s.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Loading / AI status */}
        {loading && <span style={{ color: '#888', fontSize: 12 }}>加载中...</span>}
        {statusText && (
          <span style={{ color: '#6366f1', fontSize: 12, fontWeight: 500 }}>{statusText}</span>
        )}

        {/* Extract result info (click to toggle detail panel) */}
        {extractResult && (
          <span
            style={{
              fontSize: 11,
              color: extractResult.startsWith('✓') ? '#4caf50' : '#f44336',
              maxWidth: 200,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              cursor: extractDetail ? 'pointer' : 'default',
            }}
            onClick={() => { if (extractDetail) setShowExtractDetail(!showExtractDetail); }}
            title={extractDetail ? '点击查看/隐藏详情' : undefined}
          >
            {extractResult}
          </span>
        )}

        <div style={{ flex: 1 }} />

        {/* Extract latest AI response */}
        <button
          style={{
            background: '#6366f1', border: 'none', borderRadius: 4,
            color: '#fff', fontSize: 11, padding: '3px 10px', cursor: 'pointer',
          }}
          onClick={handleExtractLatest}
          title="提取最新 AI 回复（调试用）"
        >
          📋 提取回复
        </button>

        {/* Reload */}
        <button
          style={{ background: 'transparent', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 14 }}
          onClick={() => webviewRef.current?.reload()}
          title="刷新"
        >
          ↻
        </button>

        {/* Close */}
        <button
          style={{ background: 'transparent', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 16 }}
          onClick={() => viewAPI.closeSlot()}
          title="关闭"
        >
          ×
        </button>
      </div>

      {/* AI webview content */}
      <div className="web-view__content" style={{ position: 'relative' }}>
        <webview
          ref={setupWebview}
          src={initialUrl}
          className="web-view__webview"
          partition="persist:web"
          // @ts-ignore
          allowpopups="true"
        />

        {/* Extract Debug Detail Panel */}
        {showExtractDetail && extractDetail && (
          <div style={{
            position: 'absolute', top: 0, right: 0, bottom: 0,
            width: '50%', minWidth: 300,
            background: '#1e1e1e', borderLeft: '1px solid #444',
            overflow: 'auto', zIndex: 100, padding: 12,
            fontSize: 12, color: '#ccc', fontFamily: 'monospace',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontWeight: 'bold', color: '#e8eaed' }}>提取调试面板</span>
              <button
                style={{ background: 'transparent', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 16 }}
                onClick={() => setShowExtractDetail(false)}
              >×</button>
            </div>

            {/* Block details */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: '#8ab4f8', marginBottom: 4 }}>Blocks → ExtractedBlock[] ({extractDetail.blocks.length}):</div>
              {extractDetail.blockDetails?.map((b, i) => (
                <div key={i} style={{
                  background: '#252525', borderRadius: 4, padding: '4px 8px', marginBottom: 3,
                  borderLeft: `3px solid ${
                    b.type === 'heading' ? '#ffab40' : b.type === 'code' ? '#4caf50' :
                    b.type === 'math' ? '#ce93d8' : b.type === 'image' ? '#4fc3f7' :
                    b.type === 'bulletList' || b.type === 'orderedList' ? '#ff9800' :
                    b.type === 'table' ? '#00bcd4' : b.type === 'blockquote' ? '#78909c' : '#555'
                  }`,
                }}>
                  <span style={{ color: '#8ab4f8', fontWeight: 'bold' }}>[{b.type}]</span>
                  {b.language && <span style={{ color: '#4caf50' }}> ({b.language})</span>}
                  {b.headingLevel && <span style={{ color: '#ffab40' }}> H{b.headingLevel}</span>}
                  {b.itemCount && <span style={{ color: '#ff9800' }}> {b.itemCount} items</span>}
                  {b.rows && <span style={{ color: '#00bcd4' }}> {b.rows} rows</span>}
                  {b.src && <span style={{ color: '#4fc3f7' }}> src={b.src.slice(0, 40)}</span>}
                  <span style={{ color: '#888' }}> ({b.textLength} chars)</span>
                  <div style={{ color: '#999', fontSize: 10, marginTop: 2, wordBreak: 'break-all' }}>
                    {b.textPreview}
                  </div>
                </div>
              )) ?? <div style={{ color: '#666' }}>No details</div>}
            </div>

            {/* Atom details */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: '#8ab4f8', marginBottom: 4 }}>Atoms → Atom[] ({extractDetail.atoms.length}):</div>
              {extractDetail.atomDetails?.map((a, i) => (
                <div key={i} style={{
                  background: '#252525', borderRadius: 4, padding: '4px 8px', marginBottom: 3,
                  borderLeft: '3px solid #6366f1',
                }}>
                  <span style={{ color: '#6366f1', fontWeight: 'bold' }}>[{a.type}]</span>
                  <span style={{ color: '#555' }}> {a.id}</span>
                  {a.parentId && <span style={{ color: '#444' }}> ← {a.parentId}</span>}
                  {a.textPreview && (
                    <div style={{ color: '#999', fontSize: 10, marginTop: 2, wordBreak: 'break-all' }}>
                      {a.textPreview}
                    </div>
                  )}
                </div>
              )) ?? <div style={{ color: '#666' }}>No details</div>}
            </div>

            {/* Raw markdown */}
            <div>
              <div style={{ color: '#8ab4f8', marginBottom: 4 }}>原始 SSE Markdown ({extractDetail.markdown.length} chars):</div>
              <pre style={{
                background: '#111', padding: 8, borderRadius: 4, fontSize: 11,
                whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 500, overflow: 'auto',
                border: '1px solid #333', lineHeight: 1.4,
              }}>{extractDetail.markdown}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
