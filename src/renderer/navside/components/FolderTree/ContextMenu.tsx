import { useEffect, useRef } from 'react';
import { styles } from './styles';
import type { ContextMenuItem } from './types';

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * 通用右键菜单浮层。
 *
 * - 点击外部 / Esc → 关闭
 * - separator 项渲染为分隔线
 * - disabled 项灰显不可点
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
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
  }, [onClose]);

  if (items.length === 0) return null;

  return (
    <div
      ref={ref}
      style={{ ...styles.contextMenu, left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item) => {
        if (item.separator) return <div key={item.id} style={styles.contextMenuSeparator} />;
        const itemStyle = {
          ...styles.contextMenuItem,
          ...(item.disabled ? styles.contextMenuItemDisabled : {}),
        };
        return (
          <div
            key={item.id}
            style={itemStyle}
            onClick={() => {
              if (item.disabled) return;
              item.onClick?.();
              onClose();
            }}
            onMouseEnter={(e) => {
              if (!item.disabled) e.currentTarget.style.background = '#3a3a3a';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {item.icon && <span>{item.icon}</span>}
            <span>{item.label}</span>
          </div>
        );
      })}
    </div>
  );
}
