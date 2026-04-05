import { useEffect, useRef } from 'react';
import type { EditorView } from 'prosemirror-view';

/**
 * ColorPicker — 文字颜色 + 背景高亮颜色选择器
 *
 * 参考 mirro-desktop 实现。
 */

interface ColorPickerProps {
  view: EditorView;
  onClose: () => void;
  onTextColorApplied?: (color: string) => void;
  onHighlightApplied?: (color: string) => void;
  lastTextColor: string;
  lastBgColor: string;
}

const TEXT_COLORS = [
  { name: 'Default', color: '' },
  { name: 'Gray', color: '#9aa0a6' },
  { name: 'Brown', color: '#a67c52' },
  { name: 'Orange', color: '#f29900' },
  { name: 'Yellow', color: '#f5c518' },
  { name: 'Green', color: '#34a853' },
  { name: 'Blue', color: '#8ab4f8' },
  { name: 'Purple', color: '#c58af9' },
  { name: 'Pink', color: '#f48fb1' },
  { name: 'Red', color: '#ea4335' },
];

const BG_COLORS = [
  { name: 'Default', color: '' },
  { name: 'Gray', color: 'rgba(154, 160, 166, 0.2)' },
  { name: 'Brown', color: 'rgba(166, 124, 82, 0.2)' },
  { name: 'Orange', color: 'rgba(242, 153, 0, 0.2)' },
  { name: 'Yellow', color: 'rgba(245, 197, 24, 0.2)' },
  { name: 'Green', color: 'rgba(52, 168, 83, 0.2)' },
  { name: 'Blue', color: 'rgba(138, 180, 248, 0.2)' },
  { name: 'Purple', color: 'rgba(197, 138, 249, 0.2)' },
  { name: 'Pink', color: 'rgba(244, 143, 177, 0.2)' },
  { name: 'Red', color: 'rgba(234, 67, 53, 0.2)' },
];

export function ColorPicker({ view, onClose, onTextColorApplied, onHighlightApplied, lastTextColor, lastBgColor }: ColorPickerProps) {
  const ref = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const applyTextColor = (color: string) => {
    const { from, to } = view.state.selection;
    if (from === to) return;
    const tr = view.state.tr;
    if (!color) {
      tr.removeMark(from, to, view.state.schema.marks.textStyle);
    } else {
      tr.addMark(from, to, view.state.schema.marks.textStyle.create({ color }));
    }
    view.dispatch(tr);
    onTextColorApplied?.(color);
    view.focus();
    onClose();
  };

  const applyBgColor = (color: string) => {
    const { from, to } = view.state.selection;
    if (from === to) return;
    const tr = view.state.tr;
    if (!color) {
      tr.removeMark(from, to, view.state.schema.marks.highlight);
    } else {
      tr.addMark(from, to, view.state.schema.marks.highlight.create({ color }));
    }
    view.dispatch(tr);
    onHighlightApplied?.(color);
    view.focus();
    onClose();
  };

  return (
    <div ref={ref} className="color-picker" onMouseDown={(e) => e.preventDefault()}>
      <div className="color-picker__section-label">文字颜色</div>
      <div className="color-picker__grid">
        {TEXT_COLORS.map((c) => (
          <button
            key={`t-${c.name}`}
            className={`color-picker__swatch ${lastTextColor === c.color ? 'color-picker__swatch--active' : ''}`}
            style={{ background: c.color || '#e8eaed' }}
            title={c.name}
            onClick={() => applyTextColor(c.color)}
          />
        ))}
      </div>

      <div className="color-picker__section-label" style={{ marginTop: 8 }}>背景颜色</div>
      <div className="color-picker__grid">
        {BG_COLORS.map((c) => (
          <button
            key={`b-${c.name}`}
            className={`color-picker__swatch ${lastBgColor === c.color ? 'color-picker__swatch--active' : ''}`}
            style={{ background: c.color || '#3a3a3a' }}
            title={c.name}
            onClick={() => applyBgColor(c.color)}
          />
        ))}
      </div>
    </div>
  );
}
