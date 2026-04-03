import { useState, useEffect, useCallback } from 'react';
import type { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';

/**
 * OutlinePanel — 文档大纲（Notion 风格）
 *
 * 默认：左侧显示缩略横杠（每个 heading 一条，H1 最长 H3 最短）
 * Hover：自动展开完整大纲面板，移开自动收起
 * 点击：跳转到对应 heading
 * 底部：折叠控制
 */

interface OutlinePanelProps {
  view: EditorView | null;
}

interface HeadingItem {
  level: number;
  text: string;
  pos: number;
  open: boolean;
}

const LINE_WIDTHS: Record<number, number> = { 1: 20, 2: 14, 3: 10 };

export function OutlinePanel({ view }: OutlinePanelProps) {
  const [headings, setHeadings] = useState<HeadingItem[]>([]);
  const [expanded, setExpanded] = useState(false);

  const extractHeadings = useCallback(() => {
    if (!view) return;
    const items: HeadingItem[] = [];
    view.state.doc.forEach((node, pos) => {
      if (node.type.name === 'textBlock' && node.attrs.level) {
        items.push({
          level: node.attrs.level,
          text: node.textContent || `H${node.attrs.level}`,
          pos,
          open: node.attrs.open !== false,
        });
      }
    });
    setHeadings(items);
  }, [view]);

  useEffect(() => {
    if (!view) return;
    extractHeadings();
    const interval = setInterval(extractHeadings, 800);
    return () => clearInterval(interval);
  }, [view, extractHeadings]);

  const handleClick = useCallback((pos: number) => {
    if (!view) return;
    const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1));
    view.dispatch(tr);
    view.focus();
    const dom = view.nodeDOM(pos) as HTMLElement | null;
    dom?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [view]);

  const setAllFold = useCallback((mode: 'expand' | 'h1' | 'h2' | 'collapse') => {
    if (!view) return;
    let tr = view.state.tr;
    view.state.doc.forEach((node, pos) => {
      if (node.type.name === 'textBlock' && node.attrs.level) {
        let shouldOpen: boolean;
        switch (mode) {
          case 'expand': shouldOpen = true; break;
          case 'h1': shouldOpen = node.attrs.level <= 1; break;
          case 'h2': shouldOpen = node.attrs.level <= 2; break;
          case 'collapse': shouldOpen = false; break;
        }
        if (node.attrs.open !== shouldOpen) {
          tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, open: shouldOpen });
        }
      }
    });
    view.dispatch(tr);
    extractHeadings();
  }, [view, extractHeadings]);

  // 计算第一个 heading 的 Y 偏移（相对于编辑器容器）
  const [topOffset, setTopOffset] = useState(0);
  useEffect(() => {
    if (!view || headings.length === 0) return;
    try {
      const dom = view.nodeDOM(headings[0].pos) as HTMLElement | null;
      const container = view.dom.parentElement;
      if (dom && container) {
        const domRect = dom.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        setTopOffset(domRect.top - containerRect.top);
      }
    } catch { /* ignore */ }
  }, [view, headings]);

  if (headings.length === 0) return null;

  return (
    <div
      style={{ ...styles.container, top: `${topOffset}px` }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {!expanded ? (
        /* 缩略模式：每个 heading 一个横杠 */
        <div style={styles.miniBar}>
          {headings.map((h, i) => (
            <div
              key={`${h.pos}-${i}`}
              style={{
                width: `${LINE_WIDTHS[h.level] || 10}px`,
                height: '2px',
                background: '#666',
                borderRadius: '1px',
                marginLeft: `${(h.level - 1) * 4}px`,
              }}
            />
          ))}
        </div>
      ) : (
        /* 展开模式：完整大纲 */
        <div style={styles.panel}>
          <div style={styles.list}>
            {headings.map((h, i) => (
              <div
                key={`${h.pos}-${i}`}
                style={{
                  ...styles.item,
                  paddingLeft: `${8 + (h.level - 1) * 14}px`,
                }}
                onMouseDown={(e) => { e.preventDefault(); handleClick(h.pos); }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{
                  ...styles.itemText,
                  color: h.level === 1 ? '#e8eaed' : h.level === 2 ? '#aaa' : '#4a9eff',
                  fontWeight: h.level === 1 ? 600 : 400,
                }}>
                  {h.text}
                </span>
              </div>
            ))}
          </div>
          <div style={styles.controls}>
            {(['expand', 'h1', 'h2', 'collapse'] as const).map((mode) => (
              <div
                key={mode}
                style={styles.controlItem}
                onMouseDown={(e) => { e.preventDefault(); setAllFold(mode); }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                {{ expand: '展开', h1: 'H1', h2: 'H2', collapse: '折叠' }[mode]}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    left: '8px',
    zIndex: 20,
  },
  miniBar: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '8px 4px',
    cursor: 'pointer',
    opacity: 0.5,
  },
  panel: {
    width: '200px',
    maxHeight: '60vh',
    background: 'rgba(30, 30, 30, 0.95)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '12px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    backdropFilter: 'blur(12px)',
  },
  list: {
    flex: 1,
    overflow: 'auto',
    padding: '6px 4px',
  },
  item: {
    padding: '4px 8px',
    cursor: 'pointer',
    fontSize: '13px',
    borderRadius: '6px',
    margin: '1px 2px',
  },
  itemText: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    display: 'block',
  },
  controls: {
    borderTop: '1px solid rgba(255,255,255,0.08)',
    padding: '4px',
    display: 'flex',
    gap: '2px',
  },
  controlItem: {
    flex: 1,
    padding: '4px 0',
    fontSize: '11px',
    color: '#888',
    cursor: 'pointer',
    borderRadius: '6px',
    textAlign: 'center',
  },
};
