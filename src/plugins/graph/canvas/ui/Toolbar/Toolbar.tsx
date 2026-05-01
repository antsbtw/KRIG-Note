import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';

/**
 * Canvas Toolbar — 顶部 36px 横条,对齐 NoteView 视觉
 *
 * 按钮分组(M2.0 重排,Canvas-M2-Code-Diff §8 决议):
 *   导航(‹›)│ 标题 │ flex spacer │ Shape [A] ≡ 田 ↗ │ + 新建 Open 🔄 ×
 *
 * 删除项(M2.0):🔍 zoom% / ↔ Fit(zoom 显示与 fit 仍可走快捷键)
 * 新增项(M2.0):[A] Text / ≡ Sticky / 田 Table / ↗ Line — 占位按钮,逐步通电
 *   - Text/Sticky/Table 走 M2.1 / M2.2
 *   - Line 走 M2.5(届时按钮展开为三态胶囊 line/arrow/connector)
 *
 * 与 NoteView 对齐:#252525 背景、#333 下边框、4px gap、36px 高
 *
 * UX 决策:创作组(共 5 个图标按钮)整组靠右排列,与 + 新建 Open 等通用按钮共用
 * 右侧带,左侧只留 ‹ › + 标题。
 */
export interface ToolbarProps {
  title: string;
  /** 多选时 inline 显示 Combine 按钮(spec §3.2 / M1.4d 接通) */
  multiSelected?: boolean;
  /** 添加模式中:高亮当前激活的添加按钮 */
  addModeRef?: string | null;
  /**
   * 添加模式语义类别(M2.2):'text' / 'sticky' / 'table' / 'line' / 'shape'.
   * 必要时由 CanvasView 显式提供 — 多个语义按钮可能共用同一个 ref(如 Sticky
   * 和 Text 都用 'krig.text.label',只能靠 key 区分 active 高亮).不传则
   * 退回 ref 前缀匹配(向后兼容).
   */
  addModeKey?: 'text' | 'sticky' | 'table' | 'line' | 'shape' | null;

  /** Shape 入口 — 单击弹 LibraryPicker(传 anchorRect 给 popover 定位) */
  onAdd: (anchorRect: DOMRect) => void;
  /** Text 节点入口(M2.1 通电;现占位) */
  onAddText?: (anchorRect: DOMRect) => void;
  /** Sticky 节点入口(M2.1 通电;现占位) */
  onAddSticky?: (anchorRect: DOMRect) => void;
  /** Table 节点入口(M2.2 通电;现占位) */
  onAddTable?: (anchorRect: DOMRect) => void;
  /** Line 入口(M2.5 通电;现占位 — 届时展开为 line/arrow/connector 三态胶囊) */
  onAddLine?: (anchorRect: DOMRect) => void;

  onCombine?: () => void;
  onClose: () => void;
}

export function Toolbar(props: ToolbarProps) {
  const inAddMode = props.addModeRef !== null && props.addModeRef !== undefined;
  /**
   * addModeRef 是 Library 资源 id(如 'krig.text.label' / 'krig.basic.roundRect').
   * Toolbar 按钮的 active 态用前缀匹配判断:
   *   text → 'krig.text.*'
   *   sticky → 'krig.sticky.*'(M2.2 通电后才有)
   *   table → 'krig.table.*'(M2.2)
   *   line → 'krig.line.*'(M2.5)
   *   shape → 其他全部(基础形状走通用 + 添加按钮)
   */
  // M2.2:优先 addModeKey 精确匹配(text/sticky 共用 ref);回落到 ref 前缀
  const isAddModeMatch = (category: 'text' | 'sticky' | 'table' | 'line') => {
    if (props.addModeKey) return props.addModeKey === category;
    return typeof props.addModeRef === 'string' && props.addModeRef.startsWith(`krig.${category}.`);
  };
  const isShapeAddMode =
    inAddMode &&
    !isAddModeMatch('text') &&
    !isAddModeMatch('sticky') &&
    !isAddModeMatch('table') &&
    !isAddModeMatch('line');

  return (
    <div style={styles.toolbar}>
      {/* ── Navigation(占位,M1.5+ 通电) ── */}
      <button
        style={{ ...styles.navBtn, opacity: 0.3 }}
        disabled
        title="后退(暂未实现)"
      >
        ‹
      </button>
      <button
        style={{ ...styles.navBtn, opacity: 0.3 }}
        disabled
        title="前进(暂未实现)"
      >
        ›
      </button>

      {/* ── Title ── */}
      <span style={styles.title}>{props.title}</span>

      <div style={{ flex: 1 }} />

      {/* ── 创作组(Shape + 文本三件套 + Line,共 5 个图标按钮,M2.0 整组靠右) ── */}
      <button
        style={{
          ...styles.iconBtnLg,
          ...(isShapeAddMode ? styles.actionBtnActive : null),
        }}
        onClick={(e: ReactMouseEvent<HTMLButtonElement>) =>
          props.onAdd(e.currentTarget.getBoundingClientRect())
        }
        title="添加图元(从 Library 选择)"
        aria-label="添加图元"
      >
        <ShapesIcon />
      </button>
      <button
        style={{
          ...styles.iconBtnLg,
          ...(isAddModeMatch('text') ? styles.actionBtnActive : null),
          ...(props.onAddText ? null : styles.iconBtnDisabled),
        }}
        disabled={!props.onAddText}
        onClick={(e: ReactMouseEvent<HTMLButtonElement>) =>
          props.onAddText?.(e.currentTarget.getBoundingClientRect())
        }
        title="添加文字(M2.1 通电)"
        aria-label="添加文字"
      >
        <TextIcon />
      </button>
      <button
        style={{
          ...styles.iconBtnLg,
          ...(isAddModeMatch('sticky') ? styles.actionBtnActive : null),
          ...(props.onAddSticky ? null : styles.iconBtnDisabled),
        }}
        disabled={!props.onAddSticky}
        onClick={(e: ReactMouseEvent<HTMLButtonElement>) =>
          props.onAddSticky?.(e.currentTarget.getBoundingClientRect())
        }
        title="添加便签(M2.1 通电)"
        aria-label="添加便签"
      >
        <StickyIcon />
      </button>
      <button
        style={{
          ...styles.iconBtnLg,
          ...(isAddModeMatch('table') ? styles.actionBtnActive : null),
          ...(props.onAddTable ? null : styles.iconBtnDisabled),
        }}
        disabled={!props.onAddTable}
        onClick={(e: ReactMouseEvent<HTMLButtonElement>) =>
          props.onAddTable?.(e.currentTarget.getBoundingClientRect())
        }
        title="添加表格(M2.2 通电)"
        aria-label="添加表格"
      >
        <TableIcon />
      </button>
      <button
        style={{
          ...styles.iconBtnLg,
          ...(isAddModeMatch('line') ? styles.actionBtnActive : null),
          ...(props.onAddLine ? null : styles.iconBtnDisabled),
        }}
        disabled={!props.onAddLine}
        onClick={(e: ReactMouseEvent<HTMLButtonElement>) =>
          props.onAddLine?.(e.currentTarget.getBoundingClientRect())
        }
        title="添加线条(M2.5 通电;届时展开为 line/arrow/connector 三态胶囊)"
        aria-label="添加线条"
      >
        <LineIcon />
      </button>

      {/* M1.x.10 起,Combine 入口移到右键菜单(对齐 Freeform);
          Toolbar inline 按钮已删,multiSelected/onCombine 仍保留 prop 以备未来 */}

      {/* ── 通用(占位 + 真按钮)── */}
      <span style={styles.divider} />
      <button style={{ ...styles.actionBtn, opacity: 0.3 }} disabled title="新建画板(M1.5b)">
        + 新建
      </button>
      <button style={{ ...styles.actionBtn, opacity: 0.3 }} disabled title="打开画板(M1.5b)">
        Open
      </button>
      <button style={{ ...styles.iconBtn, opacity: 0.3 }} disabled title="Slot 锁(M1.5b)">
        🔄
      </button>
      <button style={styles.closeBtn} onClick={props.onClose} title="关闭此面板">
        ×
      </button>

      {/* ── 添加模式提示条 ── */}
      {inAddMode && (
        <div style={styles.addModeHint}>
          点击画布放置 · ESC 取消
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 图标(inline SVG,精确控制视觉,不依赖系统 emoji 字体)
// ─────────────────────────────────────────────────────────

/** "Shapes" 图标:一个圆叠在圆角矩形上,对齐 Apple Pages / Keynote 工具栏 */
function ShapesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      {/* 后层:圆角矩形 */}
      <rect x="4.5" y="4.5" width="9" height="9" rx="1.5" />
      {/* 前层:圆形(略偏左上) */}
      <circle cx="6" cy="6" r="3" fill="var(--krig-bg-elevated)" />
    </svg>
  );
}

/** "Text" 图标:[A] 字母外加方框,对齐 Freeform 文字框工具 */
function TextIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
      <path d="M5.8 11 L8 5 L10.2 11" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.6 9 L9.4 9" strokeLinecap="round" />
    </svg>
  );
}

/** "Sticky"(便签)图标:三条横线代表内容,对齐 Freeform sticky 工具 */
function StickyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M5 6 L11 6" strokeLinecap="round" />
      <path d="M5 8.5 L11 8.5" strokeLinecap="round" />
      <path d="M5 11 L9 11" strokeLinecap="round" />
    </svg>
  );
}

/** "Table" 图标:2×2 网格 */
function TableIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
      <path d="M2.5 8 L13.5 8" />
      <path d="M8 2.5 L8 13.5" />
    </svg>
  );
}

/** "Line" 图标:左下 → 右上 斜线 + 末端箭头(对齐 Freeform 线条工具) */
function LineIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M3 13 L13 3" strokeLinecap="round" />
      <path d="M9 3 L13 3 L13 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────
// styles(对齐 NoteView)
// ─────────────────────────────────────────────────────────

const BTN_HEIGHT = 24;

const styles: Record<string, CSSProperties> = {
  toolbar: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    height: 36,
    padding: '0 12px',
    borderBottom: '1px solid var(--krig-border)',
    background: 'var(--krig-bg-elevated)',
    flexShrink: 0,
  },
  navBtn: {
    width: 24,
    height: 24,
    background: 'transparent',
    border: 'none',
    borderRadius: 4,
    color: 'var(--krig-text-primary)',
    fontSize: 18,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
  title: {
    fontSize: 13,
    fontWeight: 500,
    marginLeft: 8,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  divider: {
    width: 1,
    height: 18,
    background: 'var(--krig-border-light)',
    margin: '0 6px',
  },
  actionBtn: {
    background: 'transparent',
    border: '1px solid var(--krig-border-input)',
    borderRadius: 4,
    color: 'var(--krig-text-primary)',
    fontSize: 12,
    height: BTN_HEIGHT,
    padding: '0 10px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  actionBtnActive: {
    background: 'var(--krig-accent-bg)',
    border: '1px solid var(--krig-accent-border)',
  },
  iconBtnLg: {
    background: 'transparent',
    border: '1px solid var(--krig-border-input)',
    borderRadius: 4,
    color: 'var(--krig-text-primary)',
    width: 28,
    height: BTN_HEIGHT,
    padding: 0,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  iconBtnDisabled: {
    opacity: 0.3,
    cursor: 'not-allowed',
  },
  iconBtn: {
    background: 'transparent',
    border: '1px solid var(--krig-border-input)',
    borderRadius: 4,
    color: 'var(--krig-text-primary)',
    fontSize: 12,
    height: BTN_HEIGHT,
    padding: '0 8px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  combineBtn: {
    background: 'var(--krig-accent-bg)',
    border: '1px solid var(--krig-accent-border)',
    borderRadius: 4,
    color: '#fff',
    fontSize: 12,
    height: BTN_HEIGHT,
    padding: '0 10px',
    cursor: 'pointer',
    flexShrink: 0,
    marginRight: 4,
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    borderRadius: 4,
    color: 'var(--krig-text-dim)',
    fontSize: 16,
    height: BTN_HEIGHT,
    padding: '0 6px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  addModeHint: {
    position: 'absolute',
    bottom: -28,
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'var(--krig-accent-bg)',
    color: '#fff',
    fontSize: 11,
    padding: '4px 10px',
    borderRadius: 4,
    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
    zIndex: 100,
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
  },
};
