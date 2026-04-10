import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * SlotToggle — 跨 View 切换按钮
 *
 * 在 Toolbar 中渲染一个下拉按钮 [⊞ ▾]，
 * 点击后弹出菜单列出 Note / eBook / Web 三种 View，
 * 选择后在 Right Slot 中打开对应 View。
 */

declare const viewAPI: {
  openRightSlot: (workModeId: string) => Promise<void>;
  closeRightSlot: () => Promise<void>;
};

interface ViewOption {
  workModeId: string;
  icon: string;
  label: string;
}

const VIEW_OPTIONS: ViewOption[] = [
  { workModeId: 'demo-a', icon: '\u{1F4DD}', label: 'Note' },   // 📝
  { workModeId: 'demo-b', icon: '\u{1F4D5}', label: 'eBook' },  // 📕
  { workModeId: 'demo-c', icon: '\u{1F310}', label: 'Web' },    // 🌐
];

interface SlotToggleProps {
  /** 当前 right slot 中活跃的 workModeId（null 表示无 right slot） */
  activeRightModeId?: string | null;
}

export function SlotToggle({ activeRightModeId }: SlotToggleProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleToggle = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  const handleSelect = useCallback((workModeId: string) => {
    setOpen(false);
    if (activeRightModeId === workModeId) {
      // 再次点击已高亮项 → 关闭 right slot
      viewAPI.closeRightSlot();
    } else {
      viewAPI.openRightSlot(workModeId);
    }
  }, [activeRightModeId]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div ref={menuRef} style={styles.container}>
      <button
        style={styles.toggleBtn}
        onClick={handleToggle}
        title="Open view in right slot"
      >
        {'\u229E'} {'\u25BE'}
      </button>

      {open && (
        <div style={styles.menu}>
          {VIEW_OPTIONS.map((opt) => (
            <button
              key={opt.workModeId}
              style={{
                ...styles.menuItem,
                ...(activeRightModeId === opt.workModeId ? styles.menuItemActive : {}),
              }}
              onClick={() => handleSelect(opt.workModeId)}
            >
              <span style={styles.menuIcon}>{opt.icon}</span>
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'relative',
    display: 'inline-block',
    flexShrink: 0,
  },
  toggleBtn: {
    background: 'transparent',
    border: '1px solid #555',
    borderRadius: 4,
    color: '#e8eaed',
    fontSize: 12,
    padding: '2px 8px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 2,
  },
  menu: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 4,
    background: '#2d2d2d',
    border: '1px solid #555',
    borderRadius: 6,
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    zIndex: 1000,
    minWidth: 120,
    padding: '4px 0',
  },
  menuItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '6px 12px',
    background: 'transparent',
    border: 'none',
    color: '#e8eaed',
    fontSize: 13,
    cursor: 'pointer',
    textAlign: 'left' as const,
  },
  menuItemActive: {
    background: '#3a3a3a',
    color: '#7cb3f5',
  },
  menuIcon: {
    fontSize: 14,
  },
};
