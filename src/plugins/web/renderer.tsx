import { createRoot } from 'react-dom/client';
import { WebView } from './components/WebView';
import { ExtractionView } from './components/ExtractionView';

/**
 * WebView 渲染入口
 *
 * 根据 URL query 中的 variant 参数选择渲染组件：
 * - 无 variant → WebView（网页浏览器）
 * - variant=extraction → ExtractionView（PDF 提取服务）
 */

const params = new URLSearchParams(window.location.search);
const variant = params.get('variant') || '';

const rootEl = document.getElementById('root');
if (rootEl) {
  const root = createRoot(rootEl);
  if (variant === 'extraction') {
    root.render(<ExtractionView />);
  } else {
    root.render(<WebView />);
  }
}
