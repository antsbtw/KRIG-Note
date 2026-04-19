/**
 * FramePicker — 框定颜色 + 线条样式选择面板
 *
 * 复用于 ContextMenu 和 HandleMenu 的框定子菜单。
 */

import { FRAME_COLORS, FRAME_STYLES } from '../plugins/block-frame';

interface FramePickerProps {
  /** 当前框定颜色（null 表示无框定） */
  currentColor: string | null;
  /** 当前框定样式 */
  currentStyle: string | null;
  /** 选择颜色回调 */
  onColorSelect: (color: string) => void;
  /** 选择样式回调 */
  onStyleSelect: (style: 'solid' | 'double') => void;
  /** 删除框定回调 */
  onRemove: () => void;
  /** 是否显示删除按钮 */
  showRemove: boolean;
}

export function FramePicker({
  currentColor,
  currentStyle,
  onColorSelect,
  onStyleSelect,
  onRemove,
  showRemove,
}: FramePickerProps) {
  return (
    <div style={styles.container}>
      <div style={styles.sectionLabel}>边框颜色</div>
      <div style={styles.colorGrid}>
        {FRAME_COLORS.map((c) => (
          <button
            key={c.name}
            style={{
              ...styles.swatch,
              background: c.color,
              outline: currentColor === c.color ? '2px solid #e8eaed' : '2px solid transparent',
              outlineOffset: '1px',
            }}
            title={c.name}
            onMouseDown={(e) => { e.preventDefault(); onColorSelect(c.color); }}
          />
        ))}
      </div>

      <div style={{ ...styles.sectionLabel, marginTop: 8 }}>线条样式</div>
      <div style={styles.styleRow}>
        {FRAME_STYLES.map((s) => (
          <button
            key={s.value}
            style={{
              ...styles.styleBtn,
              background: currentStyle === s.value ? '#3a3a3a' : 'transparent',
            }}
            onMouseDown={(e) => { e.preventDefault(); onStyleSelect(s.value); }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#3a3a3a'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = currentStyle === s.value ? '#3a3a3a' : 'transparent'; }}
          >
            <span style={styles.stylePreview}>
              {s.value === 'solid' ? (
                <svg width="24" height="16" viewBox="0 0 24 16">
                  <rect x="2" y="2" width="20" height="12" rx="2" fill="none"
                    stroke={currentColor || '#888'} strokeWidth="2" />
                </svg>
              ) : (
                <svg width="24" height="16" viewBox="0 0 24 16">
                  <rect x="1" y="1" width="22" height="14" rx="2" fill="none"
                    stroke={currentColor || '#888'} strokeWidth="1" />
                  <rect x="3" y="3" width="18" height="10" rx="1" fill="none"
                    stroke={currentColor || '#888'} strokeWidth="1" />
                </svg>
              )}
            </span>
            <span>{s.name}</span>
          </button>
        ))}
      </div>

      {showRemove && (
        <>
          <div style={styles.separator} />
          <button
            style={styles.removeBtn}
            onMouseDown={(e) => { e.preventDefault(); onRemove(); }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#3a3a3a'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            删除框定
          </button>
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '8px 10px',
  },
  sectionLabel: {
    fontSize: 11,
    color: '#9aa0a6',
    margin: '4px 0',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  colorGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
  },
  swatch: {
    width: 22,
    height: 22,
    borderRadius: 4,
    border: 'none',
    cursor: 'pointer',
    transition: 'outline 0.1s',
  },
  styleRow: {
    display: 'flex',
    gap: '4px',
  },
  styleBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 10px',
    borderRadius: 4,
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    color: '#e8eaed',
    background: 'transparent',
  },
  stylePreview: {
    display: 'flex',
    alignItems: 'center',
  },
  separator: {
    height: 1,
    background: '#444',
    margin: '8px 0',
  },
  removeBtn: {
    display: 'block',
    width: '100%',
    padding: '6px 10px',
    borderRadius: 4,
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    color: '#ea4335',
    background: 'transparent',
    textAlign: 'left',
  },
};
