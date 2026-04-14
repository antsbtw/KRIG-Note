import { useState, useCallback, useEffect, useRef, useMemo } from 'react';

/**
 * OpenFilePopup — 通用文件搜索弹窗
 *
 * 点击 [Open] 按钮弹出搜索列表，输入关键字实时过滤，点击项目打开。
 * 用于 NoteView 和 EBookView 的 Toolbar。
 */

export interface FileItem {
  id: string;
  title: string;
}

interface OpenFilePopupProps {
  /** 按钮标签 */
  label?: string;
  /** 搜索框 placeholder */
  placeholder?: string;
  /** 加载文件列表 */
  loadItems: () => Promise<FileItem[]>;
  /** 选择文件后的回调 */
  onSelect: (id: string) => void;
}

export function OpenFilePopup({
  label = 'Open',
  placeholder = '搜索...',
  loadItems,
  onSelect,
}: OpenFilePopupProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<FileItem[]>([]);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开时加载列表 + 聚焦搜索框
  const handleOpen = useCallback(async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setQuery('');
    try {
      const list = await loadItems();
      setItems(list);
    } catch {
      setItems([]);
    }
    // 延迟聚焦，等 DOM 渲染
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, loadItems]);

  const handleSelect = useCallback((id: string) => {
    setOpen(false);
    setQuery('');
    onSelect(id);
  }, [onSelect]);

  // 过滤列表
  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((item) => item.title.toLowerCase().includes(q));
  }, [items, query]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Escape 关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <div ref={containerRef} style={styles.container}>
      <button style={styles.btn} onClick={handleOpen} title={label}>
        {label}
      </button>

      {open && (
        <div style={styles.popup}>
          <input
            ref={inputRef}
            style={styles.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            spellCheck={false}
          />
          <div style={styles.list}>
            {filtered.length === 0 && (
              <div style={styles.empty}>
                {items.length === 0 ? '暂无文件' : '无匹配结果'}
              </div>
            )}
            {filtered.map((item) => (
              <button
                key={item.id}
                style={styles.item}
                onClick={() => handleSelect(item.id)}
                title={item.title}
              >
                {item.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'relative',
    display: 'inline-block',
    flexShrink: 0,
  },
  btn: {
    background: 'transparent',
    border: '1px solid #555',
    borderRadius: 4,
    color: '#e8eaed',
    fontSize: 12,
    padding: '2px 10px',
    cursor: 'pointer',
  },
  popup: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 4,
    width: 260,
    background: '#2d2d2d',
    border: '1px solid #555',
    borderRadius: 6,
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    zIndex: 1000,
    overflow: 'hidden',
  },
  searchInput: {
    width: '100%',
    padding: '8px 10px',
    background: '#1e1e1e',
    border: 'none',
    borderBottom: '1px solid #444',
    color: '#e8eaed',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  list: {
    maxHeight: 240,
    overflowY: 'auto' as const,
    padding: '4px 0',
  },
  item: {
    display: 'block',
    width: '100%',
    padding: '6px 12px',
    background: 'transparent',
    border: 'none',
    color: '#e8eaed',
    fontSize: 13,
    cursor: 'pointer',
    textAlign: 'left' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  empty: {
    padding: '12px',
    color: '#888',
    fontSize: 12,
    textAlign: 'center' as const,
  },
};
