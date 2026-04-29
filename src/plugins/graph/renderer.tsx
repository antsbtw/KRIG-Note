import { createRoot } from 'react-dom/client';
import { CanvasView } from './canvas/CanvasView';
import './graph.css';   // 触发引入 shared/theme/tokens.css

/**
 * Graph view 入口 — 挂载到 graph.html 的 #root
 *
 * v1 只支持一个 variant:canvas(自由创作画板)。
 * 未来 family-tree / knowledge / mindmap 等 variant 走 URL ?variant=xxx 区分。
 */

const root = createRoot(document.getElementById('root')!);
root.render(<CanvasView />);
