import { useState, useEffect, useCallback } from 'react';
import type { EditorView } from 'prosemirror-view';
import type { MarkType } from 'prosemirror-model';
import { toggleMark } from 'prosemirror-commands';
import { ColorPicker } from './ColorPicker';

/**
 * FloatingToolbar — 选中文字后弹出的格式化工具栏
 *
 * 参考 mirro-desktop 实现：
 * - rangeHasMark 精确检测 active marks
 * - RAF 持续轮询选区变化
 * - CSS class 控制 active 状态
 */

interface FloatingToolbarProps {
  view: EditorView | null;
}

function isMarkActive(view: EditorView, markType: MarkType): boolean {
  const { from, $from, to, empty } = view.state.selection;
  if (empty) return !!markType.isInSet(view.state.storedMarks || $from.marks());
  return view.state.doc.rangeHasMark(from, to, markType);
}

export function FloatingToolbar({ view }: FloatingToolbarProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [, forceUpdate] = useState(0);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [lastTextColor, setLastTextColor] = useState('');
  const [lastBgColor, setLastBgColor] = useState('');

  const updatePosition = useCallback(() => {
    if (!view) return false;
    const { from, to } = view.state.selection;
    if (from === to) return false;

    // 确保在 textBlock 中
    const $from = view.state.doc.resolve(from);
    if ($from.parent.type.name !== 'textBlock') return false;

    try {
      const fromCoords = view.coordsAtPos(from);
      const toCoords = view.coordsAtPos(to);
      setPosition({
        top: Math.min(fromCoords.top, toCoords.top) - 8,
        left: (fromCoords.left + toCoords.left) / 2,
      });
      return true;
    } catch { return false; }
  }, [view]);

  // RAF 持续轮询选区变化
  useEffect(() => {
    if (!view) return;

    let rafId: number;
    let prevFrom = -1;
    let prevTo = -1;

    const check = () => {
      const { from, to } = view.state.selection;
      if (from !== prevFrom || to !== prevTo) {
        prevFrom = from;
        prevTo = to;
        if (updatePosition()) {
          setVisible(true);
          forceUpdate((n) => n + 1);
        } else {
          setVisible(false);
          setShowColorPicker(false);
        }
      }
      rafId = requestAnimationFrame(check);
    };

    rafId = requestAnimationFrame(check);
    return () => cancelAnimationFrame(rafId);
  }, [view, updatePosition]);

  if (!visible || !view) return null;

  const s = view.state.schema;

  const run = (markType: MarkType) => {
    toggleMark(markType)(view.state, view.dispatch);
    view.focus();
    forceUpdate((n) => n + 1);
  };

  const insertMathInline = () => {
    const { from, to } = view.state.selection;
    const mathType = s.nodes.mathInline;
    if (!mathType) return;

    // 选中文字作为初始 LaTeX
    const selectedText = view.state.doc.textBetween(from, to, '');
    const mathNode = mathType.create({ latex: selectedText });
    view.dispatch(view.state.tr.replaceWith(from, to, mathNode));
    view.focus();
  };

  const buttons: { label: string; mark: MarkType; render: React.ReactNode }[] = [
    { label: 'bold', mark: s.marks.bold, render: <strong>B</strong> },
    { label: 'italic', mark: s.marks.italic, render: <em>I</em> },
    { label: 'underline', mark: s.marks.underline, render: <u>U</u> },
    { label: 'strike', mark: s.marks.strike, render: <s>S</s> },
    { label: 'code', mark: s.marks.code, render: <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>&lt;&gt;</span> },
  ].filter((b) => b.mark);

  return (
    <div
      className="floating-toolbar"
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        transform: 'translate(-50%, -100%)',
        zIndex: 900,
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {buttons.map((btn) => {
        const active = isMarkActive(view, btn.mark);
        return (
          <button
            key={btn.label}
            className={`ft-btn ${active ? 'ft-btn--active' : ''}`}
            onClick={() => run(btn.mark)}
            title={btn.label}
          >
            {btn.render}
          </button>
        );
      })}

      {/* 行内公式 */}
      {s.nodes.mathInline && (
        <>
          <div className="ft-separator" />
          <button
            className="ft-btn"
            onClick={insertMathInline}
            title="行内公式"
          >
            <span style={{ fontFamily: 'serif', fontSize: '14px', fontStyle: 'italic' }}>∑</span>
          </button>
        </>
      )}

      <div className="ft-separator" />

      {/* 颜色按钮 */}
      <button
        className={`ft-btn ${showColorPicker ? 'ft-btn--active' : ''}`}
        onClick={() => setShowColorPicker(!showColorPicker)}
        title="颜色"
      >
        <span style={{ borderBottom: `2px solid ${lastTextColor || '#8ab4f8'}`, lineHeight: 1 }}>A</span>
      </button>

      {/* ColorPicker 弹出面板 */}
      {showColorPicker && (
        <div style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 4 }}>
          <ColorPicker
            view={view}
            onClose={() => setShowColorPicker(false)}
            onTextColorApplied={(c) => setLastTextColor(c)}
            onHighlightApplied={(c) => setLastBgColor(c)}
            lastTextColor={lastTextColor}
            lastBgColor={lastBgColor}
          />
        </div>
      )}
    </div>
  );
}
