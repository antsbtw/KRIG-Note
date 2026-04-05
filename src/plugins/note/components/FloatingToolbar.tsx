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
  const [, forceUpdate] = useState(0);

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

      forceUpdate((n) => n + 1); // 强制重渲染以更新 active 状态
    };

    // 监听选区变化 + dispatch 后更新
    const onSelectionChange = () => setTimeout(update, 0);
    document.addEventListener('selectionchange', onSelectionChange);

    // 拦截 dispatch 以捕获格式化操作后的状态变化
    const origDispatch = view.dispatch.bind(view);
    view.dispatch = (tr) => {
      origDispatch(tr);
      setTimeout(update, 0);
    };

    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, [view]);

  if (!coords || !view) return null;

  const s = view.state.schema;

  // 检查 mark 是否在当前选区激活
  const isMarkActive = (markType: any): boolean => {
    const { from, $from, to, empty } = view.state.selection;
    if (empty) return !!markType.isInSet(view.state.storedMarks || $from.marks());
    let active = false;
    view.state.doc.nodesBetween(from, to, (node) => {
      if (node.isText && markType.isInSet(node.marks)) active = true;
    });
    return active;
  };

  const buttons = [
    { label: 'B', mark: s.marks.bold, style: { fontWeight: 700 } },
    { label: 'I', mark: s.marks.italic, style: { fontStyle: 'italic' } },
    { label: 'U', mark: s.marks.underline, style: { textDecoration: 'underline' } },
    { label: 'S', mark: s.marks.strike, style: { textDecoration: 'line-through' } },
    { label: '<>', mark: s.marks.code, style: { fontFamily: 'monospace', fontSize: '12px' } },
  ].filter((b) => b.mark);

  return (
    <div style={{ ...styles.container, left: coords.left, top: coords.top }}>
      {buttons.map((btn) => {
        const active = isMarkActive(btn.mark!);
        return (
          <div
            key={btn.label}
            style={{
              ...styles.btn,
              ...btn.style,
              color: active ? '#4a9eff' : '#e8eaed',
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              toggleMark(btn.mark!)(view.state, view.dispatch);
              view.focus();
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#3a3a3a')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            {btn.label}
          </div>
        );
      })}
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
