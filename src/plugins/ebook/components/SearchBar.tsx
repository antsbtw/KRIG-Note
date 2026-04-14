import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * SearchBar — 文本搜索栏（Cmd+F 触发）
 *
 * 在 EBookView 顶部显示，搜索所有页面的文本内容。
 * 样式使用 CSS 类（.search-bar__*），颜色引用 CSS 变量。
 */

export interface SearchResult {
  pageNum: number;
  index: number;       // 在该页文本中的字符偏移
  text: string;        // 匹配的文本片段（含上下文）
  cfi?: string;        // EPUB 搜索结果的 CFI 定位
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
    <div className="search-bar">
      <input
        ref={inputRef}
        className="search-bar__input"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="搜索..."
      />
      <span className="search-bar__count">
        {results.length > 0 ? `${currentIndex + 1} / ${results.length}` : query ? '无结果' : ''}
      </span>
      <button className="search-bar__btn" onClick={onPrev} disabled={results.length === 0} title="上一个 (Shift+Enter)">‹</button>
      <button className="search-bar__btn" onClick={onNext} disabled={results.length === 0} title="下一个 (Enter)">›</button>
      <button className="search-bar__btn" onClick={onClose} title="关闭 (Esc)">✕</button>
    </div>
  );
}
