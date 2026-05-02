/**
 * 全局 CSS 类型扩展 — Electron 专属 CSS 属性
 *
 * React 的 CSSProperties 不识别 Electron 的拖拽区域属性，需 module augmentation 扩展。
 * 见 https://www.electronjs.org/docs/latest/api/frameless-window#draggable-region
 */
import 'react';

declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag';
  }
}
