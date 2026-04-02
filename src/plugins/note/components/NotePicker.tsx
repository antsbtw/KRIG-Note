import { useState, useEffect, useCallback, useRef } from 'react';
import type { EditorView } from 'prosemirror-view';

/**
 * NotePicker — 笔记选择面板
 *
 * 通过 SlashMenu 的 "Link to Note" 触发。
 * 显示搜索框 + 笔记列表，选中后插入 noteLink 节点。
 */

interface NotePickerProps {
  view: EditorView | null;
}

/** 触发 NotePicker 的事件名 */
export const NOTE_PICKER_EVENT = 'note-picker-open';

/** 从 SlashMenu 调用此函数打开 NotePicker */
export function triggerNotePicker(view: EditorView): void {
  const coords = view.coordsAtPos(view.state.selection.head);
  view.dom.dispatchEvent(new CustomEvent(NOTE_PICKER_EVENT, {
    detail: { left: coords.left, bottom: coords.bottom },
  }));
}

declare const viewAPI: {
  noteList: () => Promise<{ id: string; title: string }[]>;
};

export function NotePicker({ view }: NotePickerProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ left: number; bottom: number }>({ left: 0, bottom: 0 });
  const [noteList, setNoteList] = useState<{ id: string; title: string }[]>([]);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // 监听打开事件
  useEffect(() => {
    if (!view) return;

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setCoords({ left: detail.left, bottom: detail.bottom });
      setOpen(true);
      setQuery('');
      setSelectedIndex(0);

      // 加载笔记列表
      viewAPI.noteList().then((list: any[]) => {
        setNoteList(list.map((n: any) => ({ id: n.id, title: n.title || 'Untitled' })));
      });

      // 延迟聚焦搜索框
      setTimeout(() => inputRef.current?.focus(), 50);
    };

    view.dom.addEventListener(NOTE_PICKER_EVENT, handler);
    return () => view.dom.removeEventListener(NOTE_PICKER_EVENT, handler);
  }, [view]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.note-picker')) {
        setOpen(false);
        view?.focus();
      }
    };
    // 延迟绑定避免当前点击触发
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClick), 50);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handleClick); };
  }, [open, view]);

  // 过滤
  const filtered = query
    ? noteList.filter((n) => n.title.toLowerCase().includes(query.toLowerCase()))
    : noteList;

  // 重置索引
  useEffect(() => { setSelectedIndex(0); }, [filtered.length]);

  // 插入 noteLink
  const insertLink = useCallback((noteId: string, label: string) => {
    if (!view) return;
    const schema = view.state.schema;
    const noteLinkType = schema.nodes.noteLink;
    if (!noteLinkType) return;

    const node = noteLinkType.create({ noteId, label });
    view.dispatch(view.state.tr.replaceSelectionWith(node));
    setOpen(false);
    view.focus();
  }, [view]);

  // 关闭
  const close = useCallback(() => {
    setOpen(false);
    view?.focus();
  }, [view]);

  // 键盘
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[selectedIndex];
      if (item) insertLink(item.id, item.title);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }, [filtered, selectedIndex, insertLink, close]);

  if (!open) return null;

  return (
    <div className="note-picker" style={{ ...styles.container, left: coords.left, top: coords.bottom + 4 }}>
      <input
        ref={inputRef}
        style={styles.searchInput}
        placeholder="搜索笔记..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div style={styles.list}>
        {filtered.length === 0 ? (
          <div style={styles.empty}>没有匹配的笔记</div>
        ) : (
          filtered.map((note, i) => (
            <div
              key={note.id}
              style={{ ...styles.item, ...(i === selectedIndex ? styles.itemSelected : {}) }}
              onMouseDown={(e) => { e.preventDefault(); insertLink(note.id, note.title); }}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span style={styles.icon}>📄</span>
              <span style={styles.label}>{note.title}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    zIndex: 1000,
    background: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: '8px',
    padding: '4px',
    width: '280px',
    maxHeight: '320px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    display: 'flex',
    flexDirection: 'column',
  },
  searchInput: {
    width: '100%',
    height: '32px',
    padding: '0 10px',
    border: '1px solid #444',
    borderRadius: '4px',
    background: '#1e1e1e',
    color: '#e8eaed',
    fontSize: '13px',
    outline: 'none',
    marginBottom: '4px',
  },
  list: {
    overflow: 'auto',
    maxHeight: '260px',
  },
  empty: {
    padding: '12px',
    textAlign: 'center',
    color: '#666',
    fontSize: '12px',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 10px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    color: '#e8eaed',
  },
  itemSelected: {
    background: '#3a3a3a',
  },
  icon: {
    fontSize: '14px',
  },
  label: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
};
