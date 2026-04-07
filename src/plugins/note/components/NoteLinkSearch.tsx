import { useState, useEffect, useRef } from 'react';
import type { EditorView } from 'prosemirror-view';
import { noteLinkCommandKey } from '../plugins/note-link-command';

/**
 * NoteLinkSearch — [[ 触发的笔记搜索面板
 *
 * 显示所有笔记，输入过滤，Enter 选择插入 noteLink。
 */

interface NoteListItem {
  id: string;
  title: string;
}

interface NoteLinkSearchProps {
  view: EditorView | null;
}

const api = () => (window as any).viewAPI as {
  noteList: () => Promise<NoteListItem[]>;
} | undefined;

export function NoteLinkSearch({ view }: NoteLinkSearchProps) {
  const [items, setItems] = useState<NoteListItem[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!view) return;

    const update = async () => {
      const state = noteLinkCommandKey.getState(view.state);
      if (!state?.active) {
        setItems([]);
        setCoords(null);
        return;
      }

      // 获取笔记列表
      const v = api();
      if (!v) { setItems([]); return; }
      const allNotes = await v.noteList();
      const query = state.query.toLowerCase();

      const filtered = query
        ? allNotes.filter(n => n.title.toLowerCase().includes(query) || n.id.includes(query))
        : allNotes;

      setItems(filtered);
      setSelectedIdx(0);

      try {
        const coordsAt = view.coordsAtPos(state.from);
        setCoords({ left: coordsAt.left, top: coordsAt.bottom + 4 });
      } catch {
        setCoords(null);
      }
    };

    // 监听编辑器状态变化
    const origDispatch = view.dispatch.bind(view);
    view.dispatch = (tr) => {
      origDispatch(tr);
      setTimeout(update, 0);
    };
    update();

    return () => {
      view.dispatch = origDispatch;
    };
  }, [view]);

  // 键盘导航
  useEffect(() => {
    if (!view || items.length === 0) return;

    const keyHandler = (e: KeyboardEvent) => {
      const state = noteLinkCommandKey.getState(view.state);
      if (!state?.active) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (items[selectedIdx]) {
          insertNoteLink(items[selectedIdx]);
        }
      }
    };

    view.dom.addEventListener('keydown', keyHandler);
    return () => {
      view.dom.removeEventListener('keydown', keyHandler);
    };
  }, [view, items, selectedIdx]);

  function insertNoteLink(note: NoteListItem) {
    if (!view) return;

    const state = noteLinkCommandKey.getState(view.state);
    if (!state) return;

    const { from, to } = state;
    const schema = view.state.schema;
    const noteLinkType = schema.nodes.noteLink;
    if (!noteLinkType) return;

    // 关闭面板 + 删除 [[query
    let tr = view.state.tr;
    tr.setMeta(noteLinkCommandKey, { close: true });
    tr.delete(from, to);
    view.dispatch(tr);

    // 插入 noteLink 节点
    const noteLinkNode = noteLinkType.create({ noteId: note.id, label: note.title });
    const insertTr = view.state.tr.replaceSelectionWith(noteLinkNode);
    view.dispatch(insertTr);
    view.focus();
  }

  if (!coords || items.length === 0) return null;

  return (
    <div ref={menuRef} style={{ ...styles.container, left: coords.left, top: coords.top }}>
      {items.map((item, i) => (
        <div
          key={item.id}
          style={{ ...styles.item, background: i === selectedIdx ? '#3a3a3a' : 'transparent' }}
          onMouseDown={(e) => { e.preventDefault(); insertNoteLink(item); }}
          onMouseEnter={() => setSelectedIdx(i)}
        >
          <span style={styles.icon}>📄</span>
          <span style={styles.label}>{item.title || 'Untitled'}</span>
        </div>
      ))}
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
    minWidth: '200px',
    maxWidth: '350px',
    maxHeight: '300px',
    overflowY: 'auto',
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 12px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    color: '#e8eaed',
  },
  icon: {
    width: '28px',
    fontSize: '16px',
    textAlign: 'center' as const,
    marginRight: '8px',
    flexShrink: 0,
  },
  label: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
};
