import { useState, useEffect, useCallback, useRef } from 'react';
import type { EditorView } from 'prosemirror-view';
import type { MarkType } from 'prosemirror-model';
import { toggleMark } from 'prosemirror-commands';
import { applyLink as applyLinkCmd, removeLink as removeLinkCmd, insertInlineMath } from '../commands/editor-commands';
import { ColorPicker } from './ColorPicker';
import { IconTextColor } from './icons';
import { LinkPanel } from './LinkPanel';
import { getCurrentNoteId } from '../plugins/link-click';

/**
 * FloatingToolbar — 选中文字后弹出的格式化工具栏
 *
 * 功能：B/I/U/S/Code + ∑ 行内公式 + 🔗 链接 + A 颜色
 * 链接面板：三 Tab 分区（笔记 / 文件 / 网页）
 */

interface FloatingToolbarProps {
  view: EditorView | null;
}

function isMarkActive(view: EditorView, markType: MarkType): boolean {
  const { from, $from, to, empty } = view.state.selection;
  if (empty) return !!markType.isInSet(view.state.storedMarks || $from.marks());
  return view.state.doc.rangeHasMark(from, to, markType);
}

/** 获取选区上已有的 link mark 的 href */
function getActiveLinkHref(view: EditorView): string | null {
  const { from, to } = view.state.selection;
  const linkType = view.state.schema.marks.link;
  if (!linkType) return null;
  let href: string | null = null;
  view.state.doc.nodesBetween(from, to, (node) => {
    const linkMark = linkType.isInSet(node.marks);
    if (linkMark) href = linkMark.attrs.href;
  });
  return href;
}

export function FloatingToolbar({ view }: FloatingToolbarProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [, forceUpdate] = useState(0);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showLinkPanel, setShowLinkPanel] = useState(false);
  const [lastTextColor, setLastTextColor] = useState('');
  const [lastBgColor, setLastBgColor] = useState('');
  const toolbarRef = useRef<HTMLDivElement>(null);

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
      const centerX = (fromCoords.left + toCoords.left) / 2;
      const top = Math.min(fromCoords.top, toCoords.top) - 8;

      // 用 toolbar 实际宽度做边界检测；首次渲染前用估算值
      const el = toolbarRef.current;
      const toolbarW = el ? el.offsetWidth : 320;
      const halfW = toolbarW / 2;
      const pad = 8;

      let left = centerX;
      // 左边溢出：toolbar 中心在 centerX，左边缘 = centerX - halfW
      if (centerX - halfW < pad) {
        left = halfW + pad;
      }
      // 右边溢出：右边缘 = centerX + halfW
      else if (centerX + halfW > window.innerWidth - pad) {
        left = window.innerWidth - pad - halfW;
      }

      setPosition({ top, left });
      return true;
    } catch { return false; }
  }, [view]);

  // 右键菜单打开时隐藏 floating toolbar，避免两者同时出现
  const contextMenuOpen = useRef(false);
  useEffect(() => {
    if (!view) return;
    const onContext = () => { contextMenuOpen.current = true; setVisible(false); };
    const onClickRestore = () => { contextMenuOpen.current = false; };
    view.dom.addEventListener('contextmenu', onContext);
    document.addEventListener('click', onClickRestore);
    return () => {
      view.dom.removeEventListener('contextmenu', onContext);
      document.removeEventListener('click', onClickRestore);
    };
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
        if (!contextMenuOpen.current && updatePosition()) {
          setVisible(true);
          forceUpdate((n) => n + 1);
        } else {
          setVisible(false);
          setShowColorPicker(false);
          setShowLinkPanel(false);
        }
      }
      rafId = requestAnimationFrame(check);
    };

    rafId = requestAnimationFrame(check);
    return () => cancelAnimationFrame(rafId);
  }, [view, updatePosition]);

  // Cmd+K 快捷键
  useEffect(() => {
    if (!view) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        const { from, to } = view.state.selection;
        if (from !== to) {
          e.preventDefault();
          setShowLinkPanel(true);
          setShowColorPicker(false);
        }
      }
    };
    view.dom.addEventListener('keydown', handler);
    return () => view.dom.removeEventListener('keydown', handler);
  }, [view]);

  if (!visible || !view) return null;

  const s = view.state.schema;

  const run = (markType: MarkType) => {
    toggleMark(markType)(view.state, view.dispatch);
    view.focus();
    forceUpdate((n) => n + 1);
  };

  const insertMathInline = () => {
    insertInlineMath(view);
    view.focus();
  };

  const applyLink = (href: string) => {
    applyLinkCmd(view, href);
    setShowLinkPanel(false);
    view.focus();
  };

  const removeLink = () => {
    removeLinkCmd(view);
    setShowLinkPanel(false);
    view.focus();
  };

  const linkActive = s.marks.link ? isMarkActive(view, s.marks.link) : false;

  const buttons: { label: string; mark: MarkType; render: React.ReactNode }[] = [
    { label: 'bold', mark: s.marks.bold, render: <strong>B</strong> },
    { label: 'italic', mark: s.marks.italic, render: <em>I</em> },
    { label: 'underline', mark: s.marks.underline, render: <u>U</u> },
    { label: 'strike', mark: s.marks.strike, render: <s>S</s> },
    { label: 'code', mark: s.marks.code, render: <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>&lt;&gt;</span> },
  ].filter((b) => b.mark);

  return (
    <div
      ref={toolbarRef}
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

      {/* 链接按钮 */}
      {s.marks.link && (
        <button
          className={`ft-btn ${linkActive ? 'ft-btn--active' : ''}`}
          onClick={() => { setShowLinkPanel(!showLinkPanel); setShowColorPicker(false); }}
          title="链接 (⌘K)"
        >
          <span style={{ fontSize: '13px' }}>🔗</span>
        </button>
      )}

      {/* 颜色按钮(icon 复用 components/icons.tsx) */}
      <button
        className={`ft-btn ${showColorPicker ? 'ft-btn--active' : ''}`}
        onClick={() => { setShowColorPicker(!showColorPicker); setShowLinkPanel(false); }}
        title="颜色"
      >
        <IconTextColor lastColor={lastTextColor || '#8ab4f8'} />
      </button>

      {/* 链接面板 */}
      {showLinkPanel && (
        <div style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 4 }}>
          <LinkPanel
            view={view}
            currentHref={getActiveLinkHref(view)}
            onApply={applyLink}
            onRemove={removeLink}
            onClose={() => { setShowLinkPanel(false); view.focus(); }}
          />
        </div>
      )}

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
