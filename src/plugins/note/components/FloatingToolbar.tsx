import { useState, useEffect, useCallback } from 'react';
import type { EditorView } from 'prosemirror-view';
import { toggleMark } from 'prosemirror-commands';
import { blockRegistry } from '../registry';

/**
 * FloatingToolbar — 文本选中浮动工具栏
 *
 * 选中文字后出现在选区上方，显示 Mark 格式化按钮。
 * 按钮列表从当前 Block 的 capabilities.marks 派生。
 */

interface FloatingToolbarProps {
  view: EditorView | null;
}

const MARK_BUTTONS: { mark: string; label: string; icon: string; shortcut: string }[] = [
  { mark: 'bold', label: 'Bold', icon: 'B', shortcut: '⌘B' },
  { mark: 'italic', label: 'Italic', icon: 'I', shortcut: '⌘I' },
  { mark: 'underline', label: 'Underline', icon: 'U', shortcut: '⌘U' },
  { mark: 'strike', label: 'Strikethrough', icon: 'S', shortcut: '⌘⇧S' },
  { mark: 'code', label: 'Code', icon: '<>', shortcut: '⌘E' },
];

export function FloatingToolbar({ view }: FloatingToolbarProps) {
  const [toolbar, setToolbar] = useState<{
    visible: boolean;
    coords: { left: number; top: number };
    marks: string[];
    activeMarks: Set<string>;
  } | null>(null);

  useEffect(() => {
    if (!view) return;

    const update = () => {
      const { state } = view;
      const { from, to, empty } = state.selection;

      if (empty || from === to) {
        setToolbar(null);
        return;
      }

      // 找到选区所在的 Block
      const $from = state.selection.$from;
      const blockNode = $from.parent;
      const blockDef = blockRegistry.get(blockNode.type.name);
      const supportedMarks = blockDef?.capabilities.marks ?? [];

      if (supportedMarks.length === 0) {
        setToolbar(null);
        return;
      }

      // 计算选区上方的坐标
      try {
        const start = view.coordsAtPos(from);
        const end = view.coordsAtPos(to);
        const left = (start.left + end.left) / 2;
        const top = start.top - 40;

        // 检查当前活跃的 Mark
        const activeMarks = new Set<string>();
        const storedMarks = state.storedMarks || state.selection.$from.marks();
        for (const mark of storedMarks) {
          activeMarks.add(mark.type.name);
        }

        setToolbar({
          visible: true,
          coords: { left, top },
          marks: supportedMarks,
          activeMarks,
        });
      } catch {
        setToolbar(null);
      }
    };

    // 监听选区变化
    const observer = new MutationObserver(update);
    observer.observe(view.dom, { childList: true, subtree: true, characterData: true });

    // 也监听 selectionchange
    const selectionHandler = () => {
      requestAnimationFrame(update);
    };
    document.addEventListener('selectionchange', selectionHandler);

    return () => {
      observer.disconnect();
      document.removeEventListener('selectionchange', selectionHandler);
    };
  }, [view]);

  const handleToggleMark = useCallback(
    (markName: string) => {
      if (!view) return;
      const markType = view.state.schema.marks[markName];
      if (!markType) return;
      toggleMark(markType)(view.state, view.dispatch);
      view.focus();
    },
    [view],
  );

  if (!toolbar?.visible) return null;

  const visibleButtons = MARK_BUTTONS.filter((b) => toolbar.marks.includes(b.mark));
  if (visibleButtons.length === 0) return null;

  return (
    <div
      style={{
        ...styles.container,
        left: toolbar.coords.left - (visibleButtons.length * 16),
        top: toolbar.coords.top,
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {visibleButtons.map((btn) => (
        <button
          key={btn.mark}
          style={{
            ...styles.button,
            ...(toolbar.activeMarks.has(btn.mark) ? styles.buttonActive : {}),
          }}
          title={`${btn.label} (${btn.shortcut})`}
          onMouseDown={(e) => {
            e.preventDefault();
            handleToggleMark(btn.mark);
          }}
        >
          <span style={btn.mark === 'bold' ? { fontWeight: 700 } :
                        btn.mark === 'italic' ? { fontStyle: 'italic' } :
                        btn.mark === 'underline' ? { textDecoration: 'underline' } :
                        btn.mark === 'strike' ? { textDecoration: 'line-through' } :
                        btn.mark === 'code' ? { fontFamily: 'monospace', fontSize: '11px' } :
                        {}}>
            {btn.icon}
          </span>
        </button>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    zIndex: 1000,
    display: 'flex',
    gap: '2px',
    background: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: '6px',
    padding: '3px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
  },
  button: {
    width: '28px',
    height: '28px',
    border: 'none',
    borderRadius: '4px',
    background: 'transparent',
    color: '#e8eaed',
    fontSize: '13px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonActive: {
    background: '#4a9eff',
    color: '#fff',
  },
};
