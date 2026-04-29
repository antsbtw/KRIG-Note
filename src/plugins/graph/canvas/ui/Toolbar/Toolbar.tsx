import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';

/**
 * Canvas Toolbar — 顶部 36px 横条,对齐 NoteView 视觉
 *
 * 按钮分组(spec Canvas.md §3.2):
 *   导航(‹›)│ 标题 │ + Shape ◇ Substance │ 历史 │ 🔍% ↔Fit │ + 新建 Open 🔄 ×
 *
 * M1.4a 通电:标题 / + Shape / ◇ Substance / 缩放% / Fit / ×
 * M1.4a 占位:导航(M1.5+)/ 历史(v1.1)/ + 新建 Open(M1.5b)/ 🔄(M1.5b)
 *
 * 与 NoteView 对齐:#252525 背景、#333 下边框、4px gap、36px 高
 */
export interface ToolbarProps {
  title: string;
  /** 0..1+,1 = 100% */
  zoomLevel: number;
  /** 多选时 inline 显示 Combine 按钮(spec §3.2 / M1.4d 接通) */
  multiSelected?: boolean;
  /** 添加模式中:高亮对应工具按钮 */
  addModeRef?: string | null;

  /** 触发按钮被点击,回调带 anchorRect(给 LibraryPicker 定位) */
  onAddShape: (anchorRect: DOMRect) => void;
  onAddSubstance: (anchorRect: DOMRect) => void;
  onFit: () => void;
  onCombine?: () => void;
  onClose: () => void;
}

export function Toolbar(props: ToolbarProps) {
  const zoomPct = Math.round(props.zoomLevel * 100);
  const inAddMode = props.addModeRef !== null && props.addModeRef !== undefined;
  const addingShape = props.addModeRef?.startsWith('krig.') ?? false;
  const addingSubstance = props.addModeRef?.startsWith('library.') ?? false;

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

      {/* ── 创作工具组 ── */}
      <span style={styles.divider} />
      <button
        style={{
          ...styles.actionBtn,
          ...(addingShape ? styles.actionBtnActive : null),
        }}
        onClick={(e: ReactMouseEvent<HTMLButtonElement>) =>
          props.onAddShape(e.currentTarget.getBoundingClientRect())
        }
        title="添加 Shape — 从 Library 选择一个图元"
      >
        + Shape
      </button>
      <button
        style={{
          ...styles.actionBtn,
          ...(addingSubstance ? styles.actionBtnActive : null),
        }}
        onClick={(e: ReactMouseEvent<HTMLButtonElement>) =>
          props.onAddSubstance(e.currentTarget.getBoundingClientRect())
        }
        title="添加 Substance — 从 Library 选择一个组合资源"
      >
        ◇ Substance
      </button>

      {/* ── History(占位,v1.1)── */}
      <span style={styles.divider} />
      <button style={{ ...styles.iconBtn, opacity: 0.3 }} disabled title="撤销(v1.1)">
        ↶
      </button>
      <button style={{ ...styles.iconBtn, opacity: 0.3 }} disabled title="重做(v1.1)">
        ↷
      </button>

      {/* ── View(zoom 显示 + Fit)── */}
      <span style={styles.divider} />
      <span style={styles.zoomDisplay} title="当前缩放">
        🔍 {zoomPct}%
      </span>
      <button
        style={styles.iconBtn}
        onClick={props.onFit}
        title="适配全部内容(Fit to content)"
      >
        ↔
      </button>

      <div style={{ flex: 1 }} />

      {/* ── 多选时 inline Combine(M1.4d 接通)── */}
      {props.multiSelected && props.onCombine && (
        <button
          style={styles.combineBtn}
          onClick={props.onCombine}
          title="把选中的元素组合成一个 Substance"
        >
          ⊟ Combine to Substance
        </button>
      )}

      {/* ── 通用(占位 + 真按钮)── */}
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
    borderBottom: '1px solid #333',
    background: '#252525',
    flexShrink: 0,
  },
  navBtn: {
    width: 24,
    height: 24,
    background: 'transparent',
    border: 'none',
    borderRadius: 4,
    color: '#e8eaed',
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
    background: '#444',
    margin: '0 6px',
  },
  actionBtn: {
    background: 'transparent',
    border: '1px solid #555',
    borderRadius: 4,
    color: '#e8eaed',
    fontSize: 12,
    height: BTN_HEIGHT,
    padding: '0 10px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  actionBtnActive: {
    background: '#3a5a9e',
    borderColor: '#6b8ec6',
  },
  iconBtn: {
    background: 'transparent',
    border: '1px solid #555',
    borderRadius: 4,
    color: '#e8eaed',
    fontSize: 12,
    height: BTN_HEIGHT,
    padding: '0 8px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  zoomDisplay: {
    fontSize: 11,
    color: '#aaa',
    minWidth: 60,
    textAlign: 'center' as const,
    fontVariantNumeric: 'tabular-nums',
  },
  combineBtn: {
    background: '#3a5a9e',
    border: '1px solid #6b8ec6',
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
    color: '#888',
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
    background: '#3a5a9e',
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
