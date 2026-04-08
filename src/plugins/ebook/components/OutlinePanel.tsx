import { useState, useEffect, useCallback } from 'react';
import type { IBookRenderer, TOCItem } from '../types';

/**
 * OutlinePanel — 目录侧栏
 *
 * 显示 PDF/EPUB 的 outline/bookmark tree，点击跳转到对应页。
 * 样式使用 CSS 类（.outline-panel__*），颜色引用 CSS 变量。
 */

interface OutlinePanelProps {
  renderer: IBookRenderer;
  currentChapter?: string;
  currentPage?: number;
  onNavigate: (position: TOCItem['position']) => void;
  onClose: () => void;
}

export function OutlinePanel({ renderer, currentChapter, currentPage, onNavigate, onClose }: OutlinePanelProps) {
  const [toc, setToc] = useState<TOCItem[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setToc([]);
    renderer.getTOC().then((items) => {
      setToc(items);
      setLoading(false);
      const firstLevel = new Set<string>();
      items.forEach((_, i) => firstLevel.add(String(i)));
      setExpanded(firstLevel);
    }).catch(() => {
      setLoading(false);
    });
  }, [renderer]);

  const toggleExpand = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const handleClick = useCallback((item: TOCItem) => {
    onNavigate(item.position);
  }, [onNavigate]);

  const renderItems = (items: TOCItem[], depth: number, parentKey: string): React.ReactNode[] => {
    return items.map((item, index) => {
      const key = `${parentKey}-${index}`;
      const hasChildren = item.children && item.children.length > 0;
      const isExpanded = expanded.has(key);
      const page = item.position.type === 'page' ? item.position.page : null;
      const isCurrent = currentChapter
        ? item.label === currentChapter
        : currentPage && page ? page === currentPage : false;

      return (
        <div key={key}>
          <div
            className={`outline-panel__item ${isCurrent ? 'outline-panel__item--current' : ''}`}
            style={{ paddingLeft: 12 + depth * 16 }}
            onClick={() => handleClick(item)}
          >
            {hasChildren ? (
              <span
                className="outline-panel__toggle"
                onClick={(e) => { e.stopPropagation(); toggleExpand(key); }}
              >
                {isExpanded ? '▾' : '▸'}
              </span>
            ) : (
              <span className="outline-panel__toggle-placeholder" />
            )}
            <span className="outline-panel__label">{item.label}</span>
            {page && <span className="outline-panel__page">{page}</span>}
          </div>
          {hasChildren && isExpanded && renderItems(item.children!, depth + 1, key)}
        </div>
      );
    });
  };

  return (
    <div className="outline-panel">
      <div className="outline-panel__header">
        <span className="outline-panel__title">目录</span>
        <button className="outline-panel__close" onClick={onClose}>✕</button>
      </div>
      <div className="outline-panel__content">
        {loading && <div className="outline-panel__placeholder">加载中...</div>}
        {!loading && toc.length === 0 && <div className="outline-panel__placeholder">此文档没有目录</div>}
        {!loading && toc.length > 0 && renderItems(toc, 0, 'root')}
      </div>
    </div>
  );
}
