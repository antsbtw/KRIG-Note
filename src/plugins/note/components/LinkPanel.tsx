/**
 * LinkPanel — 行内链接面板(三 Tab:笔记 / 文件 / 网页)
 *
 * 抽出自 FloatingToolbar.tsx(M2.1.6d 共享化).
 *
 * 消费方:
 * - NoteView FloatingToolbar — 笔记编辑器选区浮 toolbar 的链接按钮
 * - 画板 InlineToolbar(graph/canvas/edit/InlineToolbar.tsx)— 文字节点编辑器
 * - 未来其他需要 KRIG 内部 / 外部链接的 view
 *
 * 5 种协议(配合 link-click.ts):
 *   krig://note/{id}        — 跳到 right slot note
 *   krig://block/{id}/{anchor} — 同上 + 滚动到 heading
 *   https://...             — right slot web view
 *   file://{path}           — ebook 支持格式 → right slot ebook;否则 OS 关联应用
 *   media://{id}            — OS 关联应用(M2.1 不做 right slot media,留 v1.x)
 */
import { useState, useEffect, useRef } from 'react';
import type { EditorView } from 'prosemirror-view';

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

type LinkTab = 'note' | 'file' | 'web';

export interface LinkPanelProps {
  view: EditorView;
  /** 已有链接的 href(用于自动选 Tab + 显移除按钮);无则 null */
  currentHref: string | null;
  /** 用户选好链接后调用,传入完整 href(包含协议) */
  onApply: (href: string) => void;
  /** 用户点"移除链接"时调用 */
  onRemove: () => void;
  /** 关闭面板 */
  onClose: () => void;
}

export function LinkPanel({ view, currentHref, onApply, onRemove, onClose }: LinkPanelProps) {
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

  // 二级视图:标题列表
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

  // 一级视图:笔记列表
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
      onApply(`file://${pickedFile}`);
    } else {
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
            <span style={{ marginLeft: 4 }}>链接到原文件(不复制)</span>
          </label>
          <label style={lpStyles.radioLabel}>
            <input type="radio" name="fileMode" checked={mode === 'import'} onChange={() => setMode('import')} />
            <span style={{ marginLeft: 4 }}>导入到媒体库(复制一份)</span>
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
