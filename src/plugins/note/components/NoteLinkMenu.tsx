import { useState, useEffect, useCallback, useMemo } from 'react';
import type { EditorView } from 'prosemirror-view';
import { noteLinkInputKey, type NoteLinkInputState } from '../plugins/note-link-input';

/**
 * NoteLinkMenu — [[ 触发的笔记搜索菜单
 *
 * 从 NoteFile 列表中搜索，选中后插入 noteLink 节点。
 */

interface NoteLinkMenuProps {
  view: EditorView | null;
}

declare const viewAPI: {
  noteList: () => Promise<{ id: string; title: string }[]>;
};

export function NoteLinkMenu({ view }: NoteLinkMenuProps) {
  const [pluginState, setPluginState] = useState<NoteLinkInputState | null>(null);
  const [noteList, setNoteList] = useState<{ id: string; title: string }[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // 监听 plugin 状态
  useEffect(() => {
    if (!view) return;

    const update = () => {
      const state = noteLinkInputKey.getState(view.state) as NoteLinkInputState | undefined;
      setPluginState(state?.active ? state : null);
    };

    const observer = new MutationObserver(update);
    observer.observe(view.dom, { childList: true, subtree: true, characterData: true });
    const selHandler = () => requestAnimationFrame(update);
    document.addEventListener('selectionchange', selHandler);

    // 也通过 EditorView 的 updateState 来检测（更可靠）
    const interval = setInterval(update, 100);

    update();
    return () => {
      observer.disconnect();
      document.removeEventListener('selectionchange', selHandler);
      clearInterval(interval);
    };
  }, [view]);

  // 菜单打开时加载笔记列表
  useEffect(() => {
    if (pluginState?.active) {
      viewAPI.noteList().then((list: any[]) => {
        setNoteList(list.map((n: any) => ({ id: n.id, title: n.title || 'Untitled' })));
      });
      setSelectedIndex(0);
    }
  }, [pluginState?.active]);

  // 过滤
  const filtered = useMemo(() => {
    if (!pluginState?.query) return noteList;
    const q = pluginState.query.toLowerCase();
    return noteList.filter((n) => n.title.toLowerCase().includes(q));
  }, [noteList, pluginState?.query]);

  // 重置选中索引
  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length]);

  // 插入 noteLink
  const insertNoteLink = useCallback((noteId: string, label: string) => {
    if (!view || !pluginState) return;

    const { from, to } = pluginState;
    const schema = view.state.schema;
    const noteLinkType = schema.nodes.noteLink;
    if (!noteLinkType) return;

    const node = noteLinkType.create({ noteId, label });
    let tr = view.state.tr;
    tr = tr.replaceWith(from, to, node);
    tr.setMeta(noteLinkInputKey, { close: true });
    view.dispatch(tr);
    view.focus();
  }, [view, pluginState]);

  // 键盘导航
  useEffect(() => {
    if (!view || !pluginState?.active) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = filtered[selectedIndex];
        if (item) insertNoteLink(item.id, item.title);
      }
    };

    view.dom.addEventListener('keydown', handler);
    return () => view.dom.removeEventListener('keydown', handler);
  }, [view, pluginState?.active, filtered, selectedIndex, insertNoteLink]);

  if (!pluginState?.active || !pluginState.coords || filtered.length === 0) return null;

  return (
    <div style={{
      ...styles.container,
      left: pluginState.coords.left,
      top: pluginState.coords.bottom + 4,
    }}>
      {filtered.map((note, i) => (
        <div
          key={note.id}
          style={{ ...styles.item, ...(i === selectedIndex ? styles.itemSelected : {}) }}
          onMouseDown={(e) => { e.preventDefault(); insertNoteLink(note.id, note.title); }}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <span style={styles.icon}>📄</span>
          <span style={styles.label}>{note.title}</span>
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
    maxHeight: '240px',
    overflow: 'auto',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
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
