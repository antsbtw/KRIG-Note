import { useEffect, useRef, useLayoutEffect, useState, type CSSProperties, type ReactNode } from 'react';

/**
 * Canvas ContextMenu — 右键 / 双指点击菜单
 *
 * 轻量浮层,显示对当前选区可执行的操作:
 * - 多选 ≥2:Combine to Substance
 * - 单选 / 多选:Delete
 * - 空选:无菜单(暂不显示)
 *
 * 行为:
 * - 点击外部 / ESC 关闭
 * - 视口边界自适应(right/bottom 超出 → 向左/上翻转)
 */

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  disabled?: boolean;
  separator?: boolean;
  onClick?: () => void;
  /**
   * 自定义渲染(代替默认 icon + label).例:Sticky 颜色调色盘 7 色 swatch.
   * 自定义 render 时,onClick / disabled / 默认 hover 高亮 都不生效 — 由
   * render 自己处理交互.render 内部用 onClose 关菜单(回调注入).
   */
  render?: (close: () => void) => ReactNode;
}

interface ContextMenuProps {
  /** 触发时的屏幕坐标(viewport 像素) */
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu(props: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; visible: boolean }>({
    left: props.x,
    top: props.y,
    visible: false,
  });

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) props.onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [props.onClose]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 4;
    let left = props.x;
    let top = props.y;
    if (left + rect.width > vw - margin) left = Math.max(margin, props.x - rect.width);
    if (top + rect.height > vh - margin) top = Math.max(margin, props.y - rect.height);
    setPos({ left, top, visible: true });
  }, [props.x, props.y]);

  if (props.items.length === 0) return null;

  return (
    <div
      ref={ref}
      style={{
        ...styles.menu,
        left: pos.left,
        top: pos.top,
        visibility: pos.visible ? 'visible' : 'hidden',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {props.items.map((item) => {
        if (item.separator) return <div key={item.id} style={styles.separator} />;
        // 自定义 render(如颜色 swatch 行)— 跳过默认 hover/click 包装
        if (item.render) {
          return <div key={item.id}>{item.render(props.onClose)}</div>;
        }
        const isDisabled = !!item.disabled;
        return (
          <div
            key={item.id}
            style={{
              ...styles.item,
              ...(isDisabled ? styles.itemDisabled : {}),
            }}
            onClick={() => {
              if (isDisabled) return;
              item.onClick?.();
              props.onClose();
            }}
            onMouseEnter={(e) => {
              if (!isDisabled) e.currentTarget.style.background = '#3a3a3a';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {item.icon && <span style={styles.icon}>{item.icon}</span>}
            <span>{item.label}</span>
          </div>
        );
      })}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  menu: {
    position: 'fixed',
    zIndex: 1000,
    minWidth: 180,
    background: '#252525',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 6,
    padding: 4,
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
    fontSize: 13,
    color: '#e0e0e0',
    userSelect: 'none',
  },
  item: {
    padding: '6px 12px',
    borderRadius: 4,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    transition: 'background 0.08s',
  },
  itemDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
  separator: {
    height: 1,
    background: 'rgba(255, 255, 255, 0.08)',
    margin: '4px 0',
  },
  icon: {
    width: 16,
    display: 'inline-block',
    textAlign: 'center',
  },
};
