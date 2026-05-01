/**
 * NoteView 共享 SVG icons.
 *
 * 设计目的:把所有 toolbar / menu / popup 内的 inline SVG 抽到此处,
 * 改一次所有用处同步更新.
 *
 * 使用方:
 * - HandleMenu(对齐 / 缩进 / 文字 indent 等)
 * - FloatingToolbar(B/I/U/Code/颜色/链接 等)
 * - 画板 InlineToolbar(graph/canvas/edit/InlineToolbar.tsx)
 * - 未来 Inspector / 其他 view 编辑器
 *
 * 风格:16×16 viewBox,色用 #e8eaed,粗细 1.5,圆角端点.
 */
import type { JSX } from 'react';

const FILL = '#e8eaed';

// ─────────────────────────────────────────────────────────
// 对齐(三横线)
// ─────────────────────────────────────────────────────────

/** 对齐左 — 中间一行偏短靠左 */
export const IconAlignLeft: JSX.Element = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="2" y="3" width="12" height="1.5" rx=".5" fill={FILL} />
    <rect x="2" y="7" width="8" height="1.5" rx=".5" fill={FILL} />
    <rect x="2" y="11" width="12" height="1.5" rx=".5" fill={FILL} />
  </svg>
);

/** 对齐中 — 中间一行偏短居中 */
export const IconAlignCenter: JSX.Element = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="2" y="3" width="12" height="1.5" rx=".5" fill={FILL} />
    <rect x="4" y="7" width="8" height="1.5" rx=".5" fill={FILL} />
    <rect x="2" y="11" width="12" height="1.5" rx=".5" fill={FILL} />
  </svg>
);

/** 对齐右 — 中间一行偏短靠右 */
export const IconAlignRight: JSX.Element = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="2" y="3" width="12" height="1.5" rx=".5" fill={FILL} />
    <rect x="6" y="7" width="8" height="1.5" rx=".5" fill={FILL} />
    <rect x="2" y="11" width="12" height="1.5" rx=".5" fill={FILL} />
  </svg>
);

// ─────────────────────────────────────────────────────────
// 文字颜色(带下划线的 A,underline 颜色反映"上一次选的色")
// ─────────────────────────────────────────────────────────

export function IconTextColor({ lastColor = '#8ab4f8' }: { lastColor?: string }): JSX.Element {
  return (
    <span style={{ borderBottom: `2px solid ${lastColor}`, lineHeight: 1, padding: '0 1px' }}>
      A
    </span>
  );
}

// ─────────────────────────────────────────────────────────
// 缩进(用于 HandleMenu)
// ─────────────────────────────────────────────────────────

/** 增加缩进 — 三横线 + 右箭头 */
export const IconIndentRight: JSX.Element = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M2 3h12M6 7h8M6 11h8" stroke={FILL} strokeWidth="1.5" strokeLinecap="round" />
    <path d="M2 6l2.5 2-2.5 2" stroke={FILL} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** 减少缩进 — 三横线 + 左箭头 */
export const IconIndentLeft: JSX.Element = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M2 3h12M6 7h8M6 11h8" stroke={FILL} strokeWidth="1.5" strokeLinecap="round" />
    <path d="M4.5 6L2 8l2.5 2" stroke={FILL} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
