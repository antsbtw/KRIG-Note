import { createRoot } from 'react-dom/client';
import { GraphView } from './components/GraphView';

export function renderGraphView(container: HTMLElement): void {
  const root = createRoot(container);
  root.render(<GraphView />);
}

const rootEl = document.getElementById('root');
if (rootEl) renderGraphView(rootEl);
