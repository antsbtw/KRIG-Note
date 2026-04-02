import { useState, useEffect, useCallback } from 'react';
import type { EditorView } from 'prosemirror-view';
import { toggleMark } from 'prosemirror-commands';
import { blockRegistry } from '../registry';

/**
 * FloatingToolbar — 文本选中浮动工具栏
 *
 * 选中文字后出现在选区上方，显示 Mark 格式化按钮。
 * 按钮列表从当前 Block 的 capabilities.marks 派生。
 * 包含高亮和文字颜色的颜色选择面板。
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

const HIGHLIGHT_COLORS = [
  { id: 'yellow', label: '黄色', bg: 'rgba(255, 212, 0, 0.25)' },
  { id: 'green', label: '绿色', bg: 'rgba(0, 200, 83, 0.25)' },
  { id: 'blue', label: '蓝色', bg: 'rgba(74, 158, 255, 0.25)' },
  { id: 'red', label: '红色', bg: 'rgba(255, 82, 82, 0.25)' },
  { id: 'purple', label: '紫色', bg: 'rgba(171, 71, 188, 0.25)' },
];

declare const viewAPI: {
  noteList: () => Promise<{ id: string; title: string }[]>;
};

const TEXT_COLORS = [
  { id: '#ff5252', label: '红色' },
  { id: '#ff9800', label: '橙色' },
  { id: '#4caf50', label: '绿色' },
  { id: '#4a9eff', label: '蓝色' },
  { id: '#ab47bc', label: '紫色' },
  { id: '#e8eaed', label: '默认' },
];

export function FloatingToolbar({ view }: FloatingToolbarProps) {
  const [toolbar, setToolbar] = useState<{
    visible: boolean;
    coords: { left: number; top: number };
    marks: string[];
    activeMarks: Set<string>;
  } | null>(null);

  const [showHighlight, setShowHighlight] = useState(false);
  const [showTextColor, setShowTextColor] = useState(false);

  useEffect(() => {
    if (!view) return;

    const update = () => {
      const { state } = view;
      const { from, to, empty } = state.selection;

      if (empty || from === to) {
        setToolbar(null);
        setShowHighlight(false);
        setShowTextColor(false);
        return;
      }

      const $from = state.selection.$from;
      const blockNode = $from.parent;
      const blockDef = blockRegistry.get(blockNode.type.name);
      const supportedMarks = blockDef?.capabilities.marks ?? [];

      if (supportedMarks.length === 0) {
        setToolbar(null);
        return;
      }

      try {
        const start = view.coordsAtPos(from);
        const end = view.coordsAtPos(to);
        const left = (start.left + end.left) / 2;
        const top = start.top - 40;

        const activeMarks = new Set<string>();
        const storedMarks = state.storedMarks || state.selection.$from.marks();
        for (const mark of storedMarks) {
          activeMarks.add(mark.type.name);
        }

        setToolbar({ visible: true, coords: { left, top }, marks: supportedMarks, activeMarks });
      } catch {
        setToolbar(null);
      }
    };

    const observer = new MutationObserver(update);
    observer.observe(view.dom, { childList: true, subtree: true, characterData: true });
    const selectionHandler = () => requestAnimationFrame(update);
    document.addEventListener('selectionchange', selectionHandler);

    return () => {
      observer.disconnect();
      document.removeEventListener('selectionchange', selectionHandler);
    };
  }, [view]);

  const handleToggleMark = useCallback((markName: string) => {
    if (!view) return;
    const markType = view.state.schema.marks[markName];
    if (!markType) return;
    toggleMark(markType)(view.state, view.dispatch);
    view.focus();
  }, [view]);

  const handleHighlight = useCallback((color: string) => {
    if (!view) return;
    const markType = view.state.schema.marks.highlight;
    if (!markType) return;

    const { from, to } = view.state.selection;
    // 检查选区是否已有该颜色高亮
    let hasThis = false;
    view.state.doc.nodesBetween(from, to, (node) => {
      if (node.marks.some((m) => m.type === markType && m.attrs.color === color)) hasThis = true;
    });

    if (hasThis) {
      // 移除高亮
      view.dispatch(view.state.tr.removeMark(from, to, markType));
    } else {
      // 先移除旧高亮再加新的
      let tr = view.state.tr.removeMark(from, to, markType);
      tr = tr.addMark(from, to, markType.create({ color }));
      view.dispatch(tr);
    }
    setShowHighlight(false);
    view.focus();
  }, [view]);

  const handleTextColor = useCallback((color: string) => {
    if (!view) return;
    const markType = view.state.schema.marks.textStyle;
    if (!markType) return;

    const { from, to } = view.state.selection;
    if (color === '#e8eaed') {
      // 默认色 = 移除 textStyle
      view.dispatch(view.state.tr.removeMark(from, to, markType));
    } else {
      let tr = view.state.tr.removeMark(from, to, markType);
      tr = tr.addMark(from, to, markType.create({ color }));
      view.dispatch(tr);
    }
    setShowTextColor(false);
    view.focus();
  }, [view]);

  // 选中文字 → 转为 mathInline
  const handleMathInline = useCallback(() => {
    if (!view) return;
    const { from, to } = view.state.selection;
    const selectedText = view.state.doc.textBetween(from, to, '');
    const mathType = view.state.schema.nodes.mathInline;
    if (!mathType) return;

    const mathNode = mathType.create({ latex: selectedText });
    view.dispatch(view.state.tr.replaceWith(from, to, mathNode));
    view.focus();
  }, [view]);

  // Link 面板
  const [showLinkPanel, setShowLinkPanel] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');

  const handleWebLink = useCallback(() => {
    if (!view || !linkUrl.trim()) return;
    const { from, to } = view.state.selection;
    const linkMark = view.state.schema.marks.link;
    if (!linkMark) return;
    const tr = view.state.tr.addMark(from, to, linkMark.create({ href: linkUrl.trim() }));
    view.dispatch(tr);
    setShowLinkPanel(false);
    setShowNotePicker(false);
    setLinkUrl('');
    // 取消选区，关闭 toolbar
    setTimeout(() => {
      if (view) {
        const { TextSelection } = require('prosemirror-state');
        const end = view.state.selection.to;
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)));
        view.focus();
      }
    }, 0);
  }, [view, linkUrl]);

  const handleRemoveLink = useCallback(() => {
    if (!view) return;
    const { from, to } = view.state.selection;
    const linkMark = view.state.schema.marks.link;
    if (!linkMark) return;
    view.dispatch(view.state.tr.removeMark(from, to, linkMark));
    setShowLinkPanel(false);
    view.focus();
  }, [view]);

  // 笔记链接：选中笔记后给选中文字加 link mark（href = krig://note/id）
  const [showNotePicker, setShowNotePicker] = useState(false);

  const handleNoteLink = useCallback(() => {
    if (!view) return;
    setShowNotePicker(!showNotePicker);
  }, [view, showNotePicker]);

  const handleNoteLinkSelect = useCallback((noteId: string, noteTitle: string) => {
    if (!view) return;
    const { from, to } = view.state.selection;
    const linkMark = view.state.schema.marks.link;
    if (!linkMark) return;
    const tr = view.state.tr.addMark(from, to, linkMark.create({ href: `krig://note/${noteId}`, title: noteTitle }));
    view.dispatch(tr);
    setShowNotePicker(false);
    setShowLinkPanel(false);
    // 取消选区
    setTimeout(() => {
      if (view) {
        const { TextSelection } = require('prosemirror-state');
        const end = view.state.selection.to;
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)));
        view.focus();
      }
    }, 0);
  }, [view]);

  if (!toolbar?.visible) return null;

  const visibleButtons = MARK_BUTTONS.filter((b) => toolbar.marks.includes(b.mark));
  const hasHighlight = !!view?.state.schema.marks.highlight;
  const hasTextStyle = !!view?.state.schema.marks.textStyle;
  const hasMathInline = !!view?.state.schema.nodes.mathInline;
  const hasLink = toolbar.marks.includes('link');

  if (visibleButtons.length === 0 && !hasHighlight && !hasTextStyle) return null;

  // Link 面板模式：独占显示
  if (showLinkPanel) {
    return (
      <div
        style={{ ...styles.container, left: toolbar.coords.left - 120, top: toolbar.coords.top }}
        onMouseDown={(e) => e.preventDefault()}
      >
        <div style={styles.linkPanel} onMouseDown={(e) => e.stopPropagation()}>
          <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Web 链接</div>
          <div style={styles.linkRow}>
            <input
              style={styles.linkInput}
              placeholder="输入 URL..."
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleWebLink(); }
                if (e.key === 'Escape') { e.preventDefault(); setShowLinkPanel(false); setShowNotePicker(false); }
              }}
              autoFocus
            />
            <button style={styles.linkBtn} onMouseDown={(e) => { e.preventDefault(); handleWebLink(); }}>✓</button>
          </div>
          <div style={styles.linkDivider} />
          <div
            style={styles.linkOption}
            onMouseDown={(e) => { e.preventDefault(); handleNoteLink(); }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#3a3a3a')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            📄 链接到笔记{showNotePicker ? ' ▾' : ' ▸'}
          </div>
          {showNotePicker && <NoteListInPanel onSelect={handleNoteLinkSelect} />}
          {toolbar.activeMarks.has('link') && (
            <>
              <div style={styles.linkDivider} />
              <div
                style={{ ...styles.linkOption, color: '#f87171' }}
                onMouseDown={(e) => { e.preventDefault(); handleRemoveLink(); }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#3a3a3a')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                移除链接
              </div>
            </>
          )}
          <div style={styles.linkDivider} />
          <div
            style={styles.linkOption}
            onMouseDown={(e) => { e.preventDefault(); setShowLinkPanel(false); setShowNotePicker(false); }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#3a3a3a')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            ← 返回
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        ...styles.container,
        left: toolbar.coords.left - ((visibleButtons.length + (hasHighlight ? 1 : 0) + (hasTextStyle ? 1 : 0)) * 16),
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
          onMouseDown={(e) => { e.preventDefault(); handleToggleMark(btn.mark); }}
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

      {/* 分隔线 */}
      {visibleButtons.length > 0 && (hasHighlight || hasTextStyle) && (
        <div style={styles.separator} />
      )}

      {/* 高亮按钮 */}
      {hasHighlight && (
        <div style={{ position: 'relative' }}>
          <button
            style={{
              ...styles.button,
              ...(toolbar.activeMarks.has('highlight') ? styles.buttonActive : {}),
            }}
            title="高亮"
            onMouseDown={(e) => { e.preventDefault(); setShowHighlight(!showHighlight); setShowTextColor(false); }}
          >
            <span style={{ background: 'rgba(255, 212, 0, 0.4)', padding: '0 3px', borderRadius: '2px', fontSize: '12px' }}>H</span>
          </button>
          {showHighlight && (
            <div style={styles.colorPanel}>
              {HIGHLIGHT_COLORS.map((c) => (
                <div
                  key={c.id}
                  style={{ ...styles.colorSwatch, background: c.bg, border: '1px solid #555' }}
                  title={c.label}
                  onMouseDown={(e) => { e.preventDefault(); handleHighlight(c.id); }}
                />
              ))}
              <div
                style={{ ...styles.colorSwatch, background: 'transparent', border: '1px dashed #555', fontSize: '10px', color: '#888' }}
                title="移除高亮"
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (!view) return;
                  const { from, to } = view.state.selection;
                  view.dispatch(view.state.tr.removeMark(from, to, view.state.schema.marks.highlight));
                  setShowHighlight(false);
                  view.focus();
                }}
              >✕</div>
            </div>
          )}
        </div>
      )}

      {/* 文字颜色按钮 */}
      {hasTextStyle && (
        <div style={{ position: 'relative' }}>
          <button
            style={{
              ...styles.button,
              ...(toolbar.activeMarks.has('textStyle') ? styles.buttonActive : {}),
            }}
            title="文字颜色"
            onMouseDown={(e) => { e.preventDefault(); setShowTextColor(!showTextColor); setShowHighlight(false); }}
          >
            <span style={{ fontSize: '13px', borderBottom: '2px solid #ff5252' }}>A</span>
          </button>
          {showTextColor && (
            <div style={styles.colorPanel}>
              {TEXT_COLORS.map((c) => (
                <div
                  key={c.id}
                  style={{ ...styles.colorSwatch, background: c.id, border: c.id === '#e8eaed' ? '1px dashed #555' : '1px solid transparent' }}
                  title={c.label}
                  onMouseDown={(e) => { e.preventDefault(); handleTextColor(c.id); }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 行内公式按钮 */}
      {hasMathInline && (
        <>
          <div style={styles.separator} />
          <button
            style={styles.button}
            title="行内公式（选中文字作为 LaTeX）"
            onMouseDown={(e) => { e.preventDefault(); handleMathInline(); }}
          >
            <span style={{ fontSize: '12px', fontFamily: 'serif', fontStyle: 'italic' }}>∑</span>
          </button>
        </>
      )}

      {/* 链接按钮 */}
      {hasLink && (
        <button
          style={{
            ...styles.button,
            ...(toolbar.activeMarks.has('link') ? styles.buttonActive : {}),
          }}
          title="链接"
          onMouseDown={(e) => {
            e.preventDefault();
            setShowLinkPanel(true);
            setShowHighlight(false);
            setShowTextColor(false);
          }}
        >
          <span style={{ fontSize: '13px' }}>🔗</span>
        </button>
      )}
    </div>
  );
}

/** 内嵌笔记列表（链接面板用） */
function NoteListInPanel({ onSelect }: { onSelect: (id: string, title: string) => void }) {
  const [notes, setNotes] = useState<{ id: string; title: string }[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    viewAPI.noteList().then((list: any[]) => {
      setNotes(list.map((n: any) => ({ id: n.id, title: n.title || 'Untitled' })));
    });
  }, []);

  const filtered = query
    ? notes.filter((n) => n.title.toLowerCase().includes(query.toLowerCase()))
    : notes;

  return (
    <div style={{ maxHeight: '160px', overflow: 'auto' }}>
      <input
        style={{ ...styles.linkInput, width: '100%', marginBottom: '4px' }}
        placeholder="搜索笔记..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        autoFocus
      />
      {filtered.map((n) => (
        <div
          key={n.id}
          style={styles.linkOption}
          onMouseDown={(e) => { e.preventDefault(); onSelect(n.id, n.title); }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#3a3a3a')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          📄 {n.title}
        </div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
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
  separator: {
    width: '1px',
    height: '20px',
    background: '#444',
    margin: '0 2px',
  },
  colorPanel: {
    position: 'absolute',
    top: '100%',
    left: '50%',
    transform: 'translateX(-50%)',
    marginTop: '4px',
    display: 'flex',
    gap: '4px',
    padding: '6px',
    background: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: '6px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
  },
  colorSwatch: {
    width: '22px',
    height: '22px',
    borderRadius: '4px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkPanel: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: '4px',
    padding: '6px',
    background: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: '6px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    minWidth: '240px',
  },
  linkRow: {
    display: 'flex',
    gap: '4px',
  },
  linkInput: {
    flex: 1,
    height: '28px',
    padding: '0 8px',
    background: '#1e1e1e',
    border: '1px solid #444',
    borderRadius: '4px',
    color: '#e8eaed',
    fontSize: '12px',
    outline: 'none',
  },
  linkBtn: {
    width: '28px',
    height: '28px',
    border: 'none',
    borderRadius: '4px',
    background: '#4a9eff',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '12px',
  },
  linkDivider: {
    height: '1px',
    background: '#444',
    margin: '4px 0',
  },
  linkOption: {
    padding: '6px 8px',
    fontSize: '12px',
    color: '#e8eaed',
    cursor: 'pointer',
    borderRadius: '4px',
  },
};
