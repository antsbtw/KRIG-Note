import { useState, useEffect, useCallback, useRef } from 'react';
import type { EditorView } from 'prosemirror-view';
import type { MarkType } from 'prosemirror-model';
import { toggleMark } from 'prosemirror-commands';
import { applyLink as applyLinkCmd, removeLink as removeLinkCmd, insertInlineMath } from '../commands/editor-commands';
import { ColorPicker } from './ColorPicker';
import { IconTextColor } from './icons';
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

interface NoteListItem {
  id: string;
  title: string;
}

interface HeadingItem {
  level: number;
  text: string;
}

const viewAPI = () => (window as any).viewAPI as {
  noteList: () => Promise<NoteListItem[]>;
  noteLoad: (id: string) => Promise<{ doc_content?: any[] } | null>;
  fileOpenDialog: () => Promise<{ canceled: boolean; filePath?: string }>;
  mediaPutFile: (filePath: string) => Promise<{ success: boolean; mediaUrl?: string; mediaId?: string }>;
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

// ── LinkPanel 组件（三 Tab 分区：笔记 / 文件 / 网页） ──

type LinkTab = 'note' | 'file' | 'web';

interface LinkPanelProps {
  view: EditorView;
  currentHref: string | null;
  onApply: (href: string) => void;
  onRemove: () => void;
  onClose: () => void;
}

function LinkPanel({ view, currentHref, onApply, onRemove, onClose }: LinkPanelProps) {
  // 根据已有链接的协议自动选中 Tab
  const initialTab = (): LinkTab => {
    if (!currentHref) return 'note';
    if (currentHref.startsWith('http')) return 'web';
    if (currentHref.startsWith('file://') || currentHref.startsWith('media://')) return 'file';
    return 'note';
  };
  const [tab, setTab] = useState<LinkTab>(initialTab);

  return (
    <div style={lpStyles.container} onMouseDown={(e) => e.preventDefault()}>
      {/* Tab 栏 */}
      <div style={lpStyles.tabBar}>
        {([['note', '📄 笔记'], ['file', '📎 文件'], ['web', '🔗 网页']] as const).map(([key, label]) => (
          <button
            key={key}
            style={{ ...lpStyles.tab, ...(tab === key ? lpStyles.tabActive : {}) }}
            onMouseDown={(e) => { e.preventDefault(); setTab(key); }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      {tab === 'note' && <NoteTab onApply={onApply} onClose={onClose} />}
      {tab === 'file' && <FileTab onApply={onApply} onClose={onClose} />}
      {tab === 'web' && <WebTab currentHref={currentHref?.startsWith('http') ? currentHref : null} onApply={onApply} onClose={onClose} />}

      {/* 已有链接时显示删除按钮 */}
      {currentHref && (
        <div style={lpStyles.removeRow}>
          <button style={lpStyles.removeBtn} onMouseDown={onRemove}>移除链接</button>
        </div>
      )}
    </div>
  );
}

// ── NoteTab ──

function NoteTab({ onApply, onClose }: { onApply: (href: string) => void; onClose: () => void }) {
  const [input, setInput] = useState('');
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [filteredNotes, setFilteredNotes] = useState<NoteListItem[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [drillNote, setDrillNote] = useState<{ id: string; title: string } | null>(null);
  const [headings, setHeadings] = useState<HeadingItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const v = viewAPI();
    if (v) {
      v.noteList().then((list) => {
        setNotes(list);
        setFilteredNotes(list.slice(0, 8));
      });
    }
  }, []);

  useEffect(() => {
    if (drillNote) return; // 二级视图不过滤
    if (!input) {
      setFilteredNotes(notes.slice(0, 8));
      setSelectedIdx(-1);
    } else {
      const q = input.toLowerCase();
      const matched = notes.filter(n => n.title.toLowerCase().includes(q));
      setFilteredNotes(matched.slice(0, 8));
      setSelectedIdx(matched.length > 0 ? 0 : -1);
    }
  }, [input, notes, drillNote]);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  // 加载笔记的标题列表
  const loadHeadings = async (noteId: string) => {
    const v = viewAPI();
    if (!v) return;
    const record = await v.noteLoad(noteId);
    if (!record?.doc_content) return;
    const items: HeadingItem[] = [];
    for (const atom of record.doc_content) {
      if (atom.type === 'heading' && atom.content?.children) {
        const text = atom.content.children
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('');
        if (text) items.push({ level: atom.content.level || 1, text });
      }
    }
    setHeadings(items);
  };

  const handleDrill = (note: NoteListItem) => {
    setDrillNote(note);
    loadHeadings(note.id);
  };

  const handleBack = () => {
    setDrillNote(null);
    setHeadings([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (drillNote) { handleBack(); } else { onClose(); }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = input.trim();
      if (trimmed && /^(krig:\/\/|https?:\/\/|media:\/\/|file:\/\/)/.test(trimmed)) {
        // 粘贴的链接 → 直接应用
        onApply(trimmed);
      } else if (!drillNote && selectedIdx >= 0 && filteredNotes[selectedIdx]) {
        onApply(`krig://note/${filteredNotes[selectedIdx].id}`);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const max = drillNote ? headings.length - 1 : filteredNotes.length - 1;
      setSelectedIdx(i => Math.min(i + 1, max));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, -1));
    }
  };

  // 二级视图：标题列表
  if (drillNote) {
    return (
      <div>
        <div
          style={lpStyles.backRow}
          onMouseDown={() => handleBack()}
        >
          <span style={{ marginRight: 6 }}>◀</span>
          <span style={lpStyles.noteTitle}>{drillNote.title || 'Untitled'}</span>
        </div>
        <div style={lpStyles.noteList}>
          {headings.length === 0 && (
            <div style={{ ...lpStyles.noteItem, color: '#888' }}>无标题</div>
          )}
          {headings.map((h, i) => (
            <div
              key={i}
              style={{ ...lpStyles.noteItem, paddingLeft: 8 + (h.level - 1) * 12, background: i === selectedIdx ? '#3a3a3a' : 'transparent' }}
              onMouseDown={() => onApply(`krig://block/${drillNote.id}/${encodeURIComponent(h.text)}`)}
              onMouseEnter={() => setSelectedIdx(i)}
            >
              <span style={{ marginRight: 6, fontSize: 11, color: '#888', minWidth: 20 }}>H{h.level}</span>
              <span style={lpStyles.noteTitle}>{h.text}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 一级视图：笔记列表
  return (
    <div>
      <input
        ref={inputRef}
        style={lpStyles.input}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="搜索笔记..."
      />
      {filteredNotes.length > 0 && (
        <div style={lpStyles.noteList}>
          {filteredNotes.map((note, i) => (
            <div
              key={note.id}
              style={{ ...lpStyles.noteItem, background: i === selectedIdx ? '#3a3a3a' : 'transparent' }}
              onMouseEnter={() => setSelectedIdx(i)}
            >
              <span
                style={{ flex: 1, display: 'flex', alignItems: 'center', overflow: 'hidden' }}
                onMouseDown={() => onApply(`krig://note/${note.id}`)}
              >
                <span style={{ marginRight: 6, fontSize: 12 }}>📄</span>
                <span style={lpStyles.noteTitle}>{note.title || 'Untitled'}</span>
              </span>
              <span
                style={lpStyles.drillBtn}
                onMouseDown={(e) => { e.stopPropagation(); handleDrill(note); }}
                title="查看标题列表"
              >▶</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── FileTab ──

function FileTab({ onApply, onClose }: { onApply: (href: string) => void; onClose: () => void }) {
  const [pickedFile, setPickedFile] = useState<string | null>(null);
  const [mode, setMode] = useState<'link' | 'import'>('import');
  const [importing, setImporting] = useState(false);

  const pickFile = async () => {
    const v = viewAPI();
    if (!v) return;
    const result = await v.fileOpenDialog();
    if (!result.canceled && result.filePath) {
      setPickedFile(result.filePath);
    }
  };

  const confirm = async () => {
    if (!pickedFile) return;
    if (mode === 'link') {
      // 直接引用原文件路径
      onApply(`file://${pickedFile}`);
    } else {
      // 导入到 media store
      setImporting(true);
      const v = viewAPI();
      if (v?.mediaPutFile) {
        try {
          const r = await v.mediaPutFile(pickedFile);
          if (r?.success && r.mediaUrl) {
            onApply(r.mediaUrl);
          }
        } catch { /* ignore */ }
      }
      setImporting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    if (e.key === 'Enter' && pickedFile) { e.preventDefault(); confirm(); }
  };

  return (
    <div onKeyDown={handleKeyDown} tabIndex={-1} style={{ outline: 'none' }}>
      {!pickedFile ? (
        <div style={{ padding: '16px 8px', textAlign: 'center' }}>
          <button style={lpStyles.pickFileBtn} onMouseDown={pickFile}>
            📂 选择文件...
          </button>
        </div>
      ) : (
        <div style={{ padding: '8px 4px' }}>
          <div style={{ fontSize: 13, color: '#e8eaed', marginBottom: 8, wordBreak: 'break-all' }}>
            📎 {pickedFile.split('/').pop()}
          </div>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 8, wordBreak: 'break-all' }}>
            {pickedFile}
          </div>
          <label style={lpStyles.radioLabel}>
            <input type="radio" name="fileMode" checked={mode === 'link'} onChange={() => setMode('link')} />
            <span style={{ marginLeft: 4 }}>链接到原文件（不复制）</span>
          </label>
          <label style={lpStyles.radioLabel}>
            <input type="radio" name="fileMode" checked={mode === 'import'} onChange={() => setMode('import')} />
            <span style={{ marginLeft: 4 }}>导入到笔记（复制一份）</span>
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button style={lpStyles.secondaryBtn} onMouseDown={() => setPickedFile(null)}>重选</button>
            <button style={lpStyles.confirmBtn} onMouseDown={confirm} disabled={importing}>
              {importing ? '导入中...' : '确认'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── WebTab ──

function WebTab({ currentHref, onApply, onClose }: { currentHref: string | null; onApply: (href: string) => void; onClose: () => void }) {
  const [input, setInput] = useState(currentHref || '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = input.trim();
      if (trimmed) {
        const href = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
        onApply(href);
      }
    }
  };

  return (
    <div>
      <input
        ref={inputRef}
        style={lpStyles.input}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入网页地址..."
      />
      <div style={{ fontSize: 11, color: '#888', padding: '6px 4px 0' }}>
        按 Enter 确认
      </div>
    </div>
  );
}

// ── 样式 ──

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
  tabBar: {
    display: 'flex',
    gap: 2,
    marginBottom: 8,
    borderBottom: '1px solid #444',
    paddingBottom: 6,
  },
  tab: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    color: '#888',
    fontSize: 12,
    padding: '4px 6px',
    borderRadius: 4,
    cursor: 'pointer',
  },
  tabActive: {
    background: '#3a3a3a',
    color: '#e8eaed',
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
  drillBtn: {
    fontSize: 10,
    color: '#888',
    cursor: 'pointer',
    padding: '2px 6px',
    borderRadius: 3,
    flexShrink: 0,
  },
  backRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '5px 8px',
    fontSize: 13,
    color: '#8ab4f8',
    cursor: 'pointer',
    borderBottom: '1px solid #444',
    marginBottom: 4,
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
  pickFileBtn: {
    background: '#3a3a3a',
    border: '1px solid #555',
    borderRadius: 6,
    color: '#e8eaed',
    fontSize: 13,
    padding: '8px 20px',
    cursor: 'pointer',
  },
  radioLabel: {
    display: 'flex',
    alignItems: 'center',
    fontSize: 12,
    color: '#ccc',
    padding: '3px 0',
    cursor: 'pointer',
  },
  confirmBtn: {
    flex: 1,
    background: '#8ab4f8',
    border: 'none',
    borderRadius: 4,
    color: '#1e1e1e',
    fontSize: 12,
    padding: '6px 12px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  secondaryBtn: {
    background: '#3a3a3a',
    border: '1px solid #555',
    borderRadius: 4,
    color: '#e8eaed',
    fontSize: 12,
    padding: '6px 12px',
    cursor: 'pointer',
  },
};

