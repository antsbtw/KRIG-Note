import { useState, useEffect } from 'react';
import type { EditorView } from 'prosemirror-view';
import { toggleMark } from 'prosemirror-commands';

/**
 * FloatingToolbar — 选中文字后弹出的格式化工具栏
 *
 * B I U S <> | H A
 */

interface FloatingToolbarProps {
  view: EditorView | null;
}

export function FloatingToolbar({ view }: FloatingToolbarProps) {
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!view) return;

    const update = () => {
      const { state } = view;
      const { from, to, empty } = state.selection;

      // 只在有文字选区时显示
      if (empty || from === to) { setCoords(null); return; }

      // 确保在 textBlock 中
      const $from = state.doc.resolve(from);
      if ($from.parent.type.name !== 'textBlock') { setCoords(null); return; }

      try {
        const start = view.coordsAtPos(from);
        const end = view.coordsAtPos(to);
        setCoords({
          left: (start.left + end.left) / 2,
          top: start.top - 40,
        });
      } catch { setCoords(null); }
    };

    // 用 DOM 事件监听选区变化
    const onSelectionChange = () => setTimeout(update, 0);
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [view]);

  if (!coords || !view) return null;

  const s = view.state.schema;

  const buttons = [
    { label: 'B', mark: s.marks.bold, style: { fontWeight: 700 } },
    { label: 'I', mark: s.marks.italic, style: { fontStyle: 'italic' } },
    { label: 'U', mark: s.marks.underline, style: { textDecoration: 'underline' } },
    { label: 'S', mark: s.marks.strike, style: { textDecoration: 'line-through' } },
    { label: '<>', mark: s.marks.code, style: { fontFamily: 'monospace', fontSize: '12px' } },
  ].filter((b) => b.mark);

  return (
    <div style={{ ...styles.container, left: coords.left, top: coords.top }}>
      {buttons.map((btn) => (
        <div
          key={btn.label}
          style={{ ...styles.btn, ...btn.style }}
          onMouseDown={(e) => {
            e.preventDefault();
            toggleMark(btn.mark!)(view.state, view.dispatch);
            view.focus();
          }}
        >
          {btn.label}
        </div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    zIndex: 900,
    display: 'flex',
    gap: '2px',
    background: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: '6px',
    padding: '4px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    transform: 'translateX(-50%)',
  },
  btn: {
    width: '28px',
    height: '28px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '4px',
    cursor: 'pointer',
    color: '#e8eaed',
    fontSize: '14px',
  },
};
