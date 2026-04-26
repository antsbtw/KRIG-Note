import { useEffect, useRef, useState, useLayoutEffect } from 'react';
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
 * - 边界自适应：如果 right/bottom 超出 viewport，向左/上翻转贴边
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  // 先以请求位置渲染（不可见），测量 size 后再修正位置可见
  const [pos, setPos] = useState<{ left: number; top: number; visible: boolean }>({
    left: x,
    top: y,
    visible: false,
  });

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

  // 测量 + 边界翻转（在 paint 前执行，用户看不到位置跳动）
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 4;
    let left = x;
    let top = y;
    if (left + rect.width > vw - margin) left = Math.max(margin, x - rect.width);
    if (top + rect.height > vh - margin) top = Math.max(margin, y - rect.height);
    setPos({ left, top, visible: true });
  }, [x, y]);

  if (items.length === 0) return null;

  return (
    <div
      ref={ref}
      style={{
        ...styles.contextMenu,
        left: pos.left,
        top: pos.top,
        visibility: pos.visible ? 'visible' : 'hidden',
      }}
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
