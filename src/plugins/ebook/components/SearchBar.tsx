import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * SearchBar — 文本搜索栏（Cmd+F 触发）
 *
 * 在 EBookView 顶部显示，搜索所有页面的文本内容。
 */

export interface SearchResult {
  pageNum: number;
  index: number;       // 在该页文本中的字符偏移
  text: string;        // 匹配的文本片段（含上下文）
}

interface SearchBarProps {
  visible: boolean;
  results: SearchResult[];
  currentIndex: number;
  onSearch: (query: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

export function SearchBar({ visible, results, currentIndex, onSearch, onNext, onPrev, onClose }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [visible]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    onSearch(val);
  }, [onSearch]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (e.shiftKey) onPrev(); else onNext();
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [onNext, onPrev, onClose]);

  if (!visible) return null;

  return (
    <div style={styles.bar}>
      <input
        ref={inputRef}
        style={styles.input}
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="搜索..."
      />
      <span style={styles.count}>
        {results.length > 0 ? `${currentIndex + 1} / ${results.length}` : query ? '无结果' : ''}
      </span>
      <button style={styles.btn} onClick={onPrev} disabled={results.length === 0} title="上一个 (Shift+Enter)">‹</button>
      <button style={styles.btn} onClick={onNext} disabled={results.length === 0} title="下一个 (Enter)">›</button>
      <button style={styles.btn} onClick={onClose} title="关闭 (Esc)">✕</button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 12px',
    background: '#2a2a2a',
    borderBottom: '1px solid #444',
    flexShrink: 0,
  },
  input: {
    flex: 1,
    maxWidth: 240,
    height: 24,
    background: '#333',
    border: '1px solid #555',
    borderRadius: 4,
    color: '#e8eaed',
    fontSize: 13,
    padding: '0 8px',
    outline: 'none',
  },
  count: {
    fontSize: 12,
    color: '#888',
    minWidth: 60,
  },
  btn: {
    width: 24,
    height: 24,
    background: 'transparent',
    border: 'none',
    borderRadius: 4,
    color: '#ccc',
    fontSize: 14,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};
