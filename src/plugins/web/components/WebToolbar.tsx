import { useState, useCallback, KeyboardEvent } from 'react';
import { SlotToggle } from '../../../shared/components/SlotToggle';

interface WebToolbarProps {
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isBookmarked: boolean;
  onNavigate: (url: string) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
  onBookmarkToggle: () => void;
  onCloseSlot?: () => void;
}

/**
 * WebToolbar — WebView 内部的 Toolbar
 *
 * 布局：[← →] [🔄] │ URL bar │ [★]
 */
export function WebToolbar({
  url,
  loading,
  canGoBack,
  canGoForward,
  isBookmarked,
  onNavigate,
  onGoBack,
  onGoForward,
  onReload,
  onBookmarkToggle,
  onCloseSlot,
}: WebToolbarProps) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');

  const handleUrlFocus = useCallback(() => {
    setInputValue(url);
    setEditing(true);
  }, [url]);

  const handleUrlBlur = useCallback(() => {
    setEditing(false);
  }, []);

  const handleUrlKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onNavigate(inputValue);
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      setEditing(false);
      setInputValue('');
      (e.target as HTMLInputElement).blur();
    }
  }, [inputValue, onNavigate]);

  // 显示简洁 URL（去掉协议前缀）
  const displayUrl = url.replace(/^https?:\/\//, '');

  return (
    <div className="web-toolbar">
      {/* Left: 导航按钮 */}
      <div className="web-toolbar__section web-toolbar__section--nav">
        <button
          className="web-toolbar__btn"
          onClick={onGoBack}
          disabled={!canGoBack}
          title="后退 (⌘[)"
          aria-label="后退"
        >
          ‹
        </button>
        <button
          className="web-toolbar__btn"
          onClick={onGoForward}
          disabled={!canGoForward}
          title="前进 (⌘])"
          aria-label="前进"
        >
          ›
        </button>
        <button
          className="web-toolbar__btn"
          onClick={onReload}
          title="刷新 (⌘R)"
          aria-label={loading ? '停止加载' : '刷新'}
        >
          {loading ? '✕' : '↻'}
        </button>
      </div>

      {/* Center: 地址栏 */}
      <div className="web-toolbar__section web-toolbar__section--url">
        <input
          className="web-toolbar__url-input"
          value={editing ? inputValue : displayUrl}
          onChange={(e) => setInputValue(e.target.value)}
          onFocus={handleUrlFocus}
          onBlur={handleUrlBlur}
          onKeyDown={handleUrlKeyDown}
          placeholder="输入网址或搜索..."
          spellCheck={false}
        />
      </div>

      {/* Right: 操作按钮 */}
      <div className="web-toolbar__section web-toolbar__section--actions">
        <button
          className="web-toolbar__btn"
          onClick={onBookmarkToggle}
          title={isBookmarked ? '移除书签' : '添加书签'}
          aria-label={isBookmarked ? '移除书签' : '添加书签'}
          style={{ color: isBookmarked ? '#ffd43b' : undefined }}
        >
          {isBookmarked ? '★' : '☆'}
        </button>
        <SlotToggle />
        {onCloseSlot && (
          <button className="web-toolbar__btn web-toolbar__btn--close-slot" onClick={onCloseSlot} title="关闭此面板" aria-label="关闭此面板">
            ×
          </button>
        )}
      </div>
    </div>
  );
}
