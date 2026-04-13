import { createRoot } from 'react-dom/client';
import { WebView } from './components/WebView';
import { ExtractionView } from './components/ExtractionView';
import { TranslateWebView } from './components/TranslateWebView';
import { AIWebView } from './components/AIWebView';

/**
 * WebView 渲染入口
 *
 * 根据 URL query 中的 variant 参数选择渲染组件：
 * - 无 variant → WebView（网页浏览器）
 * - variant=extraction → ExtractionView（PDF 提取服务）
 * - variant=translate → TranslateWebView（翻译浏览器）
 * - variant=ai → AIWebView（AI 对话浏览器）
 */

const params = new URLSearchParams(window.location.search);
const variant = params.get('variant') || '';
const workModeId = params.get('workModeId') || '';

const rootEl = document.getElementById('root');
if (rootEl) {
  const root = createRoot(rootEl);
  if (variant === 'ai') {
    root.render(<AIWebView workModeId={workModeId} />);
  } else if (variant === 'translate') {
    root.render(<TranslateWebView />);
  } else if (variant === 'extraction') {
    root.render(<ExtractionView />);
  } else {
    root.render(<WebView />);
  }
}
