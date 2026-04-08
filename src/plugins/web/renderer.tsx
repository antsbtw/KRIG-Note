import { createRoot } from 'react-dom/client';
import { WebView } from './components/WebView';

/**
 * WebView 渲染入口
 *
 * renderer.tsx 只负责挂载，WebView 组件包含完整的
 * Toolbar + webview 容器结构。
 */

const rootEl = document.getElementById('root');
if (rootEl) {
  const root = createRoot(rootEl);
  root.render(<WebView />);
}
