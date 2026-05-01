/**
 * FloatingPanel — 项目通用浮窗模版（首版）。
 *
 * 设计目标：所有"点击触发 → 弹小窗 → 操作完毕关闭"的浮窗（picker / 选择器 /
 * 命令面板 / 简易设置面板等）都走这个模版，避免每个浮窗手搓视觉、键盘、关闭逻辑。
 *
 * 提供：
 *   - 统一 dark 视觉（bg #1a1a1c / border #444 / radius 6 / shadow）
 *   - 锚定定位 + 边界翻转（贴近触发元素，溢出时翻到上方/左侧）
 *   - Esc / click-outside 自动关闭
 *   - 可选标题栏 + 关闭按钮
 *
 * 不做：可拖动、可缩放、模态遮罩——按需后续扩展。
 *
 * 用法：
 *   const [anchor, setAnchor] = useState<HTMLElement | null>(null);
 *   <button ref={(el) => setBtn(el)} onClick={() => setAnchor(btn)}>触发</button>
 *   {anchor && (
 *     <FloatingPanel anchor={anchor} onClose={() => setAnchor(null)} title="选择 X">
 *       ...内容
 *     </FloatingPanel>
 *   )}
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

export interface FloatingPanelProps {
  /** 锚点 DOM 元素：浮窗会贴在它下方左对齐；越界则翻到上方/右侧 */
  anchor: HTMLElement;
  /** 关闭回调（Esc / 点外部 / 标题栏 × 都会触发） */
  onClose: () => void;
  /** 浮窗内容 */
  children: ReactNode;
  /** 可选标题；提供时显示标题栏 + 关闭按钮 */
  title?: string;
  /** 浮窗宽度（px），默认 280 */
  width?: number;
  /** 浮窗最大高度（px），超出滚动；默认 360 */
  maxHeight?: number;
  /** 触发元素与浮窗之间的间距（px），默认 4 */
  gap?: number;
}

export function FloatingPanel({
  anchor,
  onClose,
  children,
  title,
  width = 280,
  maxHeight = 360,
  gap = 4,
}: FloatingPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; visible: boolean }>({
    left: 0,
    top: 0,
    visible: false,
  });

  // 边界自适应定位：默认在 anchor 下方左对齐，越界翻转
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const aRect = anchor.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 4;
    let left = aRect.left;
    let top = aRect.bottom + gap;
    if (left + eRect.width > vw - margin) left = Math.max(margin, vw - margin - eRect.width);
    if (top + eRect.height > vh - margin) top = Math.max(margin, aRect.top - eRect.height - gap);
    setPos({ left, top, visible: true });
  }, [anchor, gap]);

  // 点外部 / Esc 关闭
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node) &&
        !anchor.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [anchor, onClose]);

  return (
    <div
      ref={ref}
      style={{
        ...panelStyle,
        left: pos.left,
        top: pos.top,
        width,
        maxHeight,
        visibility: pos.visible ? 'visible' : 'hidden',
      }}
    >
      {title && (
        <div style={titleBarStyle}>
          <span style={titleTextStyle}>{title}</span>
          <button onClick={onClose} title="关闭" style={closeButtonStyle}>×</button>
        </div>
      )}
      <div style={bodyStyle}>{children}</div>
    </div>
  );
}

// ── 样式 ──

const panelStyle: CSSProperties = {
  position: 'fixed',
  background: 'rgba(26, 26, 28, 0.98)',
  border: '1px solid #444',
  borderRadius: 6,
  boxShadow: '0 4px 14px rgba(0, 0, 0, 0.5)',
  zIndex: 2000,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  fontSize: 12,
  color: '#e8eaed',
  userSelect: 'none',
};

const titleBarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '6px 10px',
  borderBottom: '1px solid #2a2a2a',
  flexShrink: 0,
};

const titleTextStyle: CSSProperties = {
  fontSize: 11,
  color: '#bbb',
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const closeButtonStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#888',
  fontSize: 16,
  cursor: 'pointer',
  padding: '0 4px',
  lineHeight: 1,
  outline: 'none',
};

const bodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  display: 'flex',
  flexDirection: 'column',
};
