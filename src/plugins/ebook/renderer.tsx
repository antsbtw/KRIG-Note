import { createRoot } from 'react-dom/client';
import { EBookView } from './components/EBookView';

/**
 * EBookView 渲染入口
 *
 * renderer.tsx 只负责挂载，EBookView 组件包含完整的
 * Toolbar + Content 结构。
 */

const rootEl = document.getElementById('root');
if (rootEl) {
  const root = createRoot(rootEl);
  root.render(<EBookView />);
}
