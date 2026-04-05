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
    let closeListener: ((e: MouseEvent) => void) | null = null;

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setMenu({ pos: detail.pos, blockType: detail.blockType, coords: detail.coords });

      // 移除旧的关闭监听
      if (closeListener) document.removeEventListener('mousedown', closeListener);

      // 下一帧注册：点击菜单外任何地方关闭
      setTimeout(() => {
        closeListener = (me: MouseEvent) => {
          // 如果点击在菜单内，不关闭
          const menuEl = document.querySelector('.handle-menu');
          if (menuEl?.contains(me.target as Node)) return;
          setMenu(null);
          if (closeListener) document.removeEventListener('mousedown', closeListener);
          closeListener = null;
        };
        document.addEventListener('mousedown', closeListener);
      }, 50);
    };

    view.dom.addEventListener('block-handle-click', handler);
    return () => {
      view.dom.removeEventListener('block-handle-click', handler);
      if (closeListener) document.removeEventListener('mousedown', closeListener);
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
    <div className="handle-menu" style={{ ...styles.container, left: menu.coords.left, top: menu.coords.top }} onMouseDown={(e) => e.stopPropagation()}>
      {menu.blockType === 'textBlock' && (
        <>
          {[
            { icon: 'T', label: '文本', action: () => setLevel(null) },
            { icon: 'H1', label: '标题 1', action: () => setLevel(1) },
            { icon: 'H2', label: '标题 2', action: () => setLevel(2) },
            { icon: 'H3', label: '标题 3', action: () => setLevel(3) },
          ].map((item) => (
            <div
              key={item.icon}
              style={styles.item}
              onMouseDown={(e) => { e.preventDefault(); item.action(); }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#3a3a3a')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={styles.icon}>{item.icon}</span><span>{item.label}</span>
            </div>
          ))}
          <div style={styles.separator} />
        </>
      )}
      <div
        style={styles.item}
        onMouseDown={(e) => { e.preventDefault(); deleteBlock(); }}
        onMouseEnter={(e) => (e.currentTarget.style.background = '#3a3a3a')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
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
