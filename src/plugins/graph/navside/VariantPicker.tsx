/**
 * VariantPicker — 新建图时选 variant 的下拉浮层（v1.4 NavSide M3）。
 *
 * 视觉：从 ActionBar 的 "+ 新建" 按钮下方弹出小卡片，列 AVAILABLE_VARIANTS。
 * 点击 variant → 创建图 → 关闭浮层。
 */
import { useEffect, useRef, useLayoutEffect, useState } from 'react';
import { AVAILABLE_VARIANTS, type VariantId } from './useGraphOperations';

interface VariantPickerProps {
  /** 锚点 DOM 元素（"+ 新建" 按钮），用于定位浮层 */
  anchor: HTMLElement;
  onPick: (variant: VariantId) => void;
  onClose: () => void;
}

export function VariantPicker({ anchor, onPick, onClose }: VariantPickerProps) {
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
    let top = aRect.bottom + 4;
    if (left + eRect.width > vw - margin) left = Math.max(margin, vw - margin - eRect.width);
    if (top + eRect.height > vh - margin) top = Math.max(margin, aRect.top - eRect.height - 4);
    setPos({ left, top, visible: true });
  }, [anchor]);

  // 点外部 / Esc 关闭
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !anchor.contains(e.target as Node)) {
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
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        visibility: pos.visible ? 'visible' : 'hidden',
        background: 'rgba(30,30,30,0.98)',
        border: '1px solid #444',
        borderRadius: 4,
        boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
        padding: '4px 0',
        minWidth: 160,
        zIndex: 2000,
        fontSize: 12,
        color: '#ccc',
      }}
    >
      {AVAILABLE_VARIANTS.map((v) => (
        <div
          key={v.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            cursor: 'pointer',
          }}
          onClick={() => {
            onPick(v.id);
            onClose();
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#3a3a3a')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <span style={{ fontSize: 14 }}>{v.icon}</span>
          <span>{v.label}</span>
        </div>
      ))}
    </div>
  );
}
