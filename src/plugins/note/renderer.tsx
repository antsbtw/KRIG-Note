import { createRoot } from 'react-dom/client';
import { NoteView } from './components/NoteView';

/**
 * NoteView 渲染入口
 *
 * renderer.tsx 只负责挂载，NoteView 组件包含完整的
 * Toolbar + Content + Overlays 结构。
 */

export function renderNoteView(container: HTMLElement): void {
  const root = createRoot(container);
  root.render(<NoteView />);
}

// 自动挂载到 #root（被 note.html 直接引用时）
const rootEl = document.getElementById('root');
if (rootEl) renderNoteView(rootEl);
