import { createRoot } from 'react-dom/client';
import { ThoughtView } from './components/ThoughtView';

/**
 * ThoughtView 渲染入口
 *
 * renderer.tsx 只负责挂载，ThoughtView 组件包含完整的
 * Panel + Cards + Editors 结构。
 */

export function renderThoughtView(container: HTMLElement): void {
  const root = createRoot(container);
  root.render(<ThoughtView />);
}

// 自动挂载到 #root（被 thought.html 直接引用时）
const rootEl = document.getElementById('root');
if (rootEl) renderThoughtView(rootEl);
