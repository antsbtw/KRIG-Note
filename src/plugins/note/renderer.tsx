import { createRoot } from 'react-dom/client';
import { NoteEditor } from './components/NoteEditor';

/**
 * Note 编辑器渲染入口
 */
export function renderNoteView(container: HTMLElement): void {
  const root = createRoot(container);
  root.render(<NoteEditor />);
}
