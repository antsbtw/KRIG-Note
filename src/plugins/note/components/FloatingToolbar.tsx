import { useState, useEffect, useCallback, useRef } from 'react';
import type { EditorView } from 'prosemirror-view';
import type { MarkType } from 'prosemirror-model';
import { toggleMark } from 'prosemirror-commands';
import { ColorPicker } from './ColorPicker';
import { addThought } from '../commands/thought-commands';
import { askAI, getSelectedText } from '../commands/ask-ai-command';
import { THOUGHT_TYPE_META } from '../../../shared/types/thought-types';
import type { ThoughtType } from '../../../shared/types/thought-types';
import { getAIServiceList, DEFAULT_AI_SERVICE } from '../../../shared/types/ai-service-types';
import type { AIServiceId } from '../../../shared/types/ai-service-types';

/**
 * FloatingToolbar — 选中文字后弹出的格式化工具栏
 *
 * 功能：B/I/U/S/Code + ∑ 行内公式 + 🔗 链接 + A 颜色
 * 链接面板：输入 URL 或搜索 Note 文件
 */

interface FloatingToolbarProps {
  view: EditorView | null;
}

interface NoteListItem {
  id: string;
  title: string;
}

const viewAPI = () => (window as any).viewAPI as {
  noteList: () => Promise<NoteListItem[]>;
} | undefined;

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
  const [showThoughtMenu, setShowThoughtMenu] = useState(false);
  const [showAIMenu, setShowAIMenu] = useState(false);
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

  // Handle menu "Ask AI" trigger — auto-open AI panel
  useEffect(() => {
    if (!view) return;
    const handler = () => {
      setShowAIMenu(true);
      setShowThoughtMenu(false);
      setShowColorPicker(false);
      setShowLinkPanel(false);
    };
    view.dom.addEventListener('ask-ai-from-handle', handler);
    return () => view.dom.removeEventListener('ask-ai-from-handle', handler);
  }, [view]);

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
    const selectedText = view.state.doc.textBetween(from, to, '');
    const mathNode = mathType.create({ latex: selectedText });
    view.dispatch(view.state.tr.replaceWith(from, to, mathNode));
    view.focus();
  };

  const applyLink = (href: string) => {
    const linkType = s.marks.link;
    if (!linkType || !href) return;
    const { from, to } = view.state.selection;
    const tr = view.state.tr.addMark(from, to, linkType.create({ href }));
    view.dispatch(tr);
    setShowLinkPanel(false);
    view.focus();
  };

  const removeLink = () => {
    const linkType = s.marks.link;
    if (!linkType) return;
    const { from, to } = view.state.selection;
    const tr = view.state.tr.removeMark(from, to, linkType);
    view.dispatch(tr);
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

      {/* 颜色按钮 */}
      <button
        className={`ft-btn ${showColorPicker ? 'ft-btn--active' : ''}`}
        onClick={() => { setShowColorPicker(!showColorPicker); setShowLinkPanel(false); }}
        title="颜色"
      >
        <span style={{ borderBottom: `2px solid ${lastTextColor || '#8ab4f8'}`, lineHeight: 1 }}>A</span>
      </button>

      {/* 思考按钮 + 类型菜单 */}
      <div className="ft-separator" />
      <button
        className={`ft-btn ${showThoughtMenu ? 'ft-btn--active' : ''}`}
        onClick={() => { setShowThoughtMenu(!showThoughtMenu); setShowAIMenu(false); setShowColorPicker(false); setShowLinkPanel(false); }}
        title="添加思考 (⌘⇧M)"
      >
        <span style={{ fontSize: '13px' }}>💭</span>
      </button>

      {/* 思考类型选择菜单 */}
      {showThoughtMenu && (
        <div style={{
          position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
          marginTop: 4, background: '#2a2a2a', border: '1px solid #444', borderRadius: 8,
          padding: 4, zIndex: 1000, boxShadow: '0 4px 12px rgba(0,0,0,0.4)', minWidth: 120,
        }} onMouseDown={(e) => e.preventDefault()}>
          {(Object.keys(THOUGHT_TYPE_META) as ThoughtType[]).map((t) => {
            const m = THOUGHT_TYPE_META[t];
            return (
              <button
                key={t}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '6px 12px', background: 'transparent', border: 'none',
                  color: '#e8eaed', fontSize: 13, cursor: 'pointer', borderRadius: 4,
                  textAlign: 'left' as const,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#3a3a3a')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                onClick={() => {
                  setShowThoughtMenu(false);
                  if (view) addThought(view, t);
                }}
              >
                <span>{m.icon}</span>
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* 问 AI 按钮 + 输入面板 */}
      <button
        className={`ft-btn ${showAIMenu ? 'ft-btn--active' : ''}`}
        onClick={() => { setShowAIMenu(!showAIMenu); setShowThoughtMenu(false); setShowColorPicker(false); setShowLinkPanel(false); }}
        title="问 AI"
      >
        <span style={{ fontSize: '13px' }}>🤖</span>
      </button>

      {showAIMenu && view && (
        <div style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 4 }}>
          <AskAIPanel
            view={view}
            onSend={(serviceId, instruction) => {
              setShowAIMenu(false);
              askAI(view, serviceId, instruction);
            }}
            onClose={() => { setShowAIMenu(false); view.focus(); }}
          />
        </div>
      )}

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

// ── LinkPanel 组件 ──

interface LinkPanelProps {
  view: EditorView;
  currentHref: string | null;
  onApply: (href: string) => void;
  onRemove: () => void;
  onClose: () => void;
}

function LinkPanel({ view, currentHref, onApply, onRemove, onClose }: LinkPanelProps) {
  const [input, setInput] = useState(currentHref || '');
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [filteredNotes, setFilteredNotes] = useState<NoteListItem[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  // 加载笔记列表
  useEffect(() => {
    const v = viewAPI();
    if (v) {
      v.noteList().then((list) => {
        setNotes(list);
        setFilteredNotes(list.slice(0, 8));
      });
    }
  }, []);

  // 过滤笔记
  useEffect(() => {
    if (!input || input.startsWith('http://') || input.startsWith('https://')) {
      setFilteredNotes(notes.slice(0, 8));
      setSelectedIdx(-1);
    } else {
      const q = input.toLowerCase();
      const matched = notes.filter(n => n.title.toLowerCase().includes(q));
      setFilteredNotes(matched.slice(0, 8));
      setSelectedIdx(matched.length > 0 ? 0 : -1);
    }
  }, [input, notes]);

  // 自动聚焦
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIdx >= 0 && filteredNotes[selectedIdx]) {
        onApply(`krig://note/${filteredNotes[selectedIdx].id}`);
      } else if (input.trim()) {
        // 直接作为 URL
        const href = input.trim().startsWith('http') ? input.trim() : `https://${input.trim()}`;
        onApply(href);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, filteredNotes.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, -1));
    }
  };

  return (
    <div style={lpStyles.container} onMouseDown={(e) => e.preventDefault()}>
      <input
        ref={inputRef}
        style={lpStyles.input}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="搜索笔记或输入 URL..."
      />

      {/* 笔记列表 */}
      {filteredNotes.length > 0 && (
        <div style={lpStyles.noteList}>
          {filteredNotes.map((note, i) => (
            <div
              key={note.id}
              style={{ ...lpStyles.noteItem, background: i === selectedIdx ? '#3a3a3a' : 'transparent' }}
              onMouseDown={() => onApply(`krig://note/${note.id}`)}
              onMouseEnter={() => setSelectedIdx(i)}
            >
              <span style={{ marginRight: 6, fontSize: 12 }}>📄</span>
              <span style={lpStyles.noteTitle}>{note.title || 'Untitled'}</span>
            </div>
          ))}
        </div>
      )}

      {/* 已有链接时显示删除按钮 */}
      {currentHref && (
        <div style={lpStyles.removeRow}>
          <button style={lpStyles.removeBtn} onMouseDown={onRemove}>移除链接</button>
        </div>
      )}
    </div>
  );
}

const lpStyles: Record<string, React.CSSProperties> = {
  container: {
    background: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: 8,
    padding: 8,
    minWidth: 280,
    maxWidth: 350,
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
  },
  input: {
    width: '100%',
    padding: '6px 8px',
    background: '#1e1e1e',
    border: '1px solid #555',
    borderRadius: 4,
    color: '#e8eaed',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  noteList: {
    marginTop: 6,
    maxHeight: 200,
    overflowY: 'auto' as const,
  },
  noteItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '5px 8px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 13,
    color: '#e8eaed',
  },
  noteTitle: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  removeRow: {
    marginTop: 6,
    borderTop: '1px solid #444',
    paddingTop: 6,
  },
  removeBtn: {
    background: 'transparent',
    border: 'none',
    color: '#f28b82',
    cursor: 'pointer',
    fontSize: 12,
    padding: '2px 4px',
  },
};

// ── AskAIPanel 组件 ──

interface AskAIPanelProps {
  view: EditorView;
  onSend: (serviceId: AIServiceId, instruction: string) => void;
  onClose: () => void;
}

function AskAIPanel({ view, onSend, onClose }: AskAIPanelProps) {
  const [instruction, setInstruction] = useState('');
  const [serviceId, setServiceId] = useState<AIServiceId>(DEFAULT_AI_SERVICE);
  const [showServiceMenu, setShowServiceMenu] = useState(false);
  const [selectedText, setSelectedText] = useState(() => getSelectedText(view));
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  // Track selection changes — update preview when user re-selects
  useEffect(() => {
    const handleSelectionUpdate = () => {
      const text = getSelectedText(view);
      if (text && text !== selectedText) {
        setSelectedText(text);
      }
    };
    // ProseMirror doesn't have a simple selection event, so poll briefly
    // when the view regains focus (user clicked back to re-select)
    const interval = setInterval(handleSelectionUpdate, 500);
    return () => clearInterval(interval);
  }, [view, selectedText]);

  const handleSend = () => {
    // Re-read the latest selection at send time
    const latestText = getSelectedText(view) || selectedText;
    if (!instruction.trim() && !latestText.trim()) return;
    onSend(serviceId, instruction);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  const services = getAIServiceList();
  const currentService = services.find(s => s.id === serviceId) || services[0];
  const previewText = selectedText.length > 120 ? selectedText.slice(0, 120) + '...' : selectedText;

  return (
    <div
      style={askAIPanelStyles.container}
      onMouseDown={(e) => {
        // Allow interaction with the panel without losing editor selection
        // But stop propagation so the FloatingToolbar doesn't hide
        e.stopPropagation();
      }}
    >
      {/* Header with close button */}
      <div style={askAIPanelStyles.header}>
        <span style={{ color: '#aaa', fontSize: 12 }}>🤖 问 AI</span>
        <button
          style={askAIPanelStyles.closeBtn}
          onClick={onClose}
          title="关闭 (Esc)"
        >
          ×
        </button>
      </div>

      {/* Selected content preview */}
      <div style={askAIPanelStyles.preview}>
        <span style={askAIPanelStyles.previewLabel}>
          选中内容：
          {!previewText && <span style={{ color: '#666', fontStyle: 'italic' }}>请在编辑器中选择文字</span>}
        </span>
        {previewText && <span style={askAIPanelStyles.previewText}>{previewText}</span>}
      </div>

      {/* Instruction input */}
      <textarea
        ref={inputRef}
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="请输入你的问题..."
        style={askAIPanelStyles.textarea}
        rows={2}
      />

      {/* Bottom bar: service selector + send button */}
      <div style={askAIPanelStyles.bottomBar}>
        {/* Service selector */}
        <div style={{ position: 'relative' }}>
          <button
            style={askAIPanelStyles.serviceBtn}
            onClick={() => setShowServiceMenu(!showServiceMenu)}
          >
            {currentService.icon} {currentService.name} ▾
          </button>
          {showServiceMenu && (
            <div style={askAIPanelStyles.serviceMenu}>
              {services.map((s) => (
                <button
                  key={s.id}
                  style={{
                    ...askAIPanelStyles.serviceOption,
                    background: s.id === serviceId ? '#3a3a3a' : 'transparent',
                  }}
                  onClick={() => { setServiceId(s.id as AIServiceId); setShowServiceMenu(false); }}
                >
                  {s.icon} {s.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          style={{
            ...askAIPanelStyles.sendBtn,
            opacity: (!instruction.trim() && !selectedText.trim()) ? 0.4 : 1,
          }}
          onClick={handleSend}
          disabled={!instruction.trim() && !selectedText.trim()}
        >
          发送 ▶
        </button>
      </div>
    </div>
  );
}

const askAIPanelStyles: Record<string, React.CSSProperties> = {
  container: {
    background: '#2a2a2a',
    border: '1px solid #555',
    borderRadius: 10,
    padding: 12,
    width: 320,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    zIndex: 1000,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: '#888',
    fontSize: 16,
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: 1,
  },
  preview: {
    background: '#1e1e1e',
    borderRadius: 6,
    padding: '8px 10px',
    marginBottom: 8,
    fontSize: 12,
    lineHeight: '1.4',
    borderLeft: '3px solid #6366f1',
  },
  previewLabel: {
    color: '#888',
    display: 'block',
    marginBottom: 4,
    fontSize: 11,
  },
  previewText: {
    color: '#ccc',
    wordBreak: 'break-word' as const,
  },
  textarea: {
    width: '100%',
    background: '#1e1e1e',
    border: '1px solid #444',
    borderRadius: 6,
    color: '#e8eaed',
    fontSize: 13,
    padding: '8px 10px',
    resize: 'vertical' as const,
    outline: 'none',
    fontFamily: 'inherit',
    lineHeight: '1.4',
    boxSizing: 'border-box' as const,
  },
  bottomBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  serviceBtn: {
    background: '#333',
    border: '1px solid #555',
    borderRadius: 6,
    color: '#ccc',
    fontSize: 12,
    padding: '4px 10px',
    cursor: 'pointer',
  },
  serviceMenu: {
    position: 'absolute' as const,
    bottom: '100%',
    left: 0,
    marginBottom: 4,
    background: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: 8,
    padding: 4,
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    minWidth: 120,
  },
  serviceOption: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '6px 12px',
    border: 'none',
    color: '#e8eaed',
    fontSize: 12,
    cursor: 'pointer',
    borderRadius: 4,
    textAlign: 'left' as const,
  },
  sendBtn: {
    background: '#6366f1',
    border: 'none',
    borderRadius: 6,
    color: '#fff',
    fontSize: 12,
    padding: '5px 14px',
    cursor: 'pointer',
    fontWeight: 600,
  },
};
