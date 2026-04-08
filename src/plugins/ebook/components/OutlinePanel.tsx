import { useState, useEffect, useCallback } from 'react';
import type { IBookRenderer, TOCItem } from '../types';

/**
 * OutlinePanel — PDF 目录侧栏
 *
 * 显示 PDF 的 outline/bookmark tree，点击跳转到对应页。
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
            style={{
              ...styles.item,
              paddingLeft: 12 + depth * 16,
              ...(isCurrent ? styles.itemCurrent : {}),
            }}
            onClick={() => handleClick(item)}
            onMouseEnter={(e) => { if (!isCurrent) (e.currentTarget as HTMLElement).style.background = '#333'; }}
            onMouseLeave={(e) => { if (!isCurrent) (e.currentTarget as HTMLElement).style.background = ''; }}
          >
            {hasChildren ? (
              <span
                style={styles.toggle}
                onClick={(e) => { e.stopPropagation(); toggleExpand(key); }}
              >
                {isExpanded ? '▾' : '▸'}
              </span>
            ) : (
              <span style={styles.togglePlaceholder} />
            )}
            <span style={styles.label}>{item.label}</span>
            {page && <span style={styles.page}>{page}</span>}
          </div>
          {hasChildren && isExpanded && renderItems(item.children!, depth + 1, key)}
        </div>
      );
    });
  };

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.title}>目录</span>
        <button style={styles.closeBtn} onClick={onClose}>✕</button>
      </div>
      <div style={styles.content}>
        {loading && <div style={styles.placeholder}>加载中...</div>}
        {!loading && toc.length === 0 && <div style={styles.placeholder}>此文档没有目录</div>}
        {!loading && toc.length > 0 && renderItems(toc, 0, 'root')}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: 260,
    height: '100%',
    background: '#1e1e1e',
    borderRight: '1px solid #333',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: '1px solid #333',
  },
  title: {
    fontSize: 13,
    fontWeight: 600,
    color: '#e8eaed',
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: '#888',
    fontSize: 14,
    cursor: 'pointer',
    padding: '2px 4px',
  },
  content: {
    flex: 1,
    overflowY: 'auto',
    padding: '4px 0',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 8px',
    cursor: 'pointer',
    fontSize: 12,
    color: '#ccc',
    userSelect: 'none' as const,
  },
  itemCurrent: {
    background: '#264f78',
    color: '#fff',
    borderRadius: 3,
  },
  toggle: {
    width: 16,
    fontSize: 12,
    color: '#888',
    flexShrink: 0,
    cursor: 'pointer',
  },
  togglePlaceholder: {
    width: 16,
    flexShrink: 0,
  },
  label: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  page: {
    fontSize: 11,
    color: '#666',
    marginLeft: 8,
    flexShrink: 0,
  },
  placeholder: {
    padding: 16,
    textAlign: 'center' as const,
    color: '#666',
    fontSize: 13,
  },
};
