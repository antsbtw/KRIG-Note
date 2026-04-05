import { useState, useEffect } from 'react';
import type { EditorView } from 'prosemirror-view';

/**
 * HandleMenu — 手柄点击后的操作菜单
 *
 * 转换成 / 删除
 */

interface HandleMenuProps {
  view: EditorView | null;
}

interface MenuState {
  pos: number;
  blockType: string;
  coords: { left: number; top: number };
}

export function HandleMenu({ view }: HandleMenuProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    if (!view) return;
    let closeListener: (() => void) | null = null;

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setMenu({ pos: detail.pos, blockType: detail.blockType, coords: detail.coords });

      // 延迟注册关闭监听（避免同一帧的 click 冒泡立即关闭）
      if (closeListener) document.removeEventListener('click', closeListener);
      closeListener = () => setMenu(null);
      setTimeout(() => {
        if (closeListener) document.addEventListener('click', closeListener);
      }, 0);
    };

    view.dom.addEventListener('block-handle-click', handler);
    return () => {
      view.dom.removeEventListener('block-handle-click', handler);
      if (closeListener) document.removeEventListener('click', closeListener);
    };
  }, [view]);

  if (!menu || !view) return null;

  const close = () => setMenu(null);

  const deleteBlock = () => {
    const node = view.state.doc.nodeAt(menu.pos);
    if (node) {
      view.dispatch(view.state.tr.delete(menu.pos, menu.pos + node.nodeSize));
    }
    close();
  };

  const setLevel = (level: number | null) => {
    const node = view.state.doc.nodeAt(menu.pos);
    if (node?.type.name === 'textBlock') {
      view.dispatch(view.state.tr.setNodeMarkup(menu.pos, undefined, { ...node.attrs, level }));
    }
    close();
  };

  return (
    <div style={{ ...styles.container, left: menu.coords.left, top: menu.coords.top }} onClick={(e) => e.stopPropagation()}>
      {menu.blockType === 'textBlock' && (
        <>
          <div style={styles.item} onMouseDown={(e) => { e.preventDefault(); setLevel(null); }}>
            <span style={styles.icon}>T</span><span>文本</span>
          </div>
          <div style={styles.item} onMouseDown={(e) => { e.preventDefault(); setLevel(1); }}>
            <span style={styles.icon}>H1</span><span>标题 1</span>
          </div>
          <div style={styles.item} onMouseDown={(e) => { e.preventDefault(); setLevel(2); }}>
            <span style={styles.icon}>H2</span><span>标题 2</span>
          </div>
          <div style={styles.item} onMouseDown={(e) => { e.preventDefault(); setLevel(3); }}>
            <span style={styles.icon}>H3</span><span>标题 3</span>
          </div>
          <div style={styles.separator} />
        </>
      )}
      <div style={styles.item} onMouseDown={(e) => { e.preventDefault(); deleteBlock(); }}>
        <span style={styles.icon}>🗑</span><span>删除</span>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed', zIndex: 1000,
    background: '#2a2a2a', border: '1px solid #444', borderRadius: '8px',
    padding: '4px', minWidth: '160px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
  },
  item: {
    display: 'flex', alignItems: 'center', padding: '6px 12px',
    borderRadius: '4px', cursor: 'pointer', fontSize: '14px', color: '#e8eaed',
  },
  icon: { width: '28px', textAlign: 'center' as const, marginRight: '8px', flexShrink: 0 },
  separator: { height: '1px', background: '#444', margin: '4px 8px' },
};
