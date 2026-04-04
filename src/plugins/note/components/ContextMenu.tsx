import { useState, useEffect } from 'react';
import type { EditorView } from 'prosemirror-view';

/**
 * ContextMenu — 右键菜单
 *
 * Cut / Copy / Paste + Delete
 */

interface ContextMenuProps {
  view: EditorView | null;
}

interface MenuState {
  coords: { left: number; top: number };
}

export function ContextMenu({ view }: ContextMenuProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    if (!view) return;

    const handler = (e: MouseEvent) => {
      e.preventDefault();
      setMenu({ coords: { left: e.clientX, top: e.clientY } });
    };

    const close = () => setMenu(null);

    view.dom.addEventListener('contextmenu', handler);
    document.addEventListener('click', close);

    return () => {
      view.dom.removeEventListener('contextmenu', handler);
      document.removeEventListener('click', close);
    };
  }, [view]);

  if (!menu || !view) return null;

  const close = () => setMenu(null);

  const items = [
    {
      id: 'cut', label: 'Cut', icon: '✂', shortcut: '⌘X',
      action: () => { document.execCommand('cut'); close(); },
    },
    {
      id: 'copy', label: 'Copy', icon: '📋', shortcut: '⌘C',
      action: () => { document.execCommand('copy'); close(); },
    },
    {
      id: 'paste', label: 'Paste', icon: '📄', shortcut: '⌘V',
      action: async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (text) view.dispatch(view.state.tr.insertText(text));
        } catch { document.execCommand('paste'); }
        close();
      },
    },
    {
      id: 'delete', label: 'Delete', icon: '🗑', shortcut: '⌫',
      action: () => {
        const { $from } = view.state.selection;
        if ($from.depth >= 1) {
          const pos = $from.before(1);
          const node = view.state.doc.nodeAt(pos);
          if (node && !(node.type.name === 'textBlock' && node.attrs.isTitle)) {
            view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize));
          }
        }
        close();
      },
    },
  ];

  return (
    <div style={{ ...styles.container, left: menu.coords.left, top: menu.coords.top }} onClick={(e) => e.stopPropagation()}>
      {items.map((item) => (
        <div
          key={item.id}
          style={styles.item}
          onMouseDown={(e) => { e.preventDefault(); item.action(); }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#3a3a3a')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <span style={styles.icon}>{item.icon}</span>
          <span style={styles.label}>{item.label}</span>
          <span style={styles.shortcut}>{item.shortcut}</span>
        </div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed', zIndex: 1000,
    background: '#2a2a2a', border: '1px solid #444', borderRadius: '8px',
    padding: '4px', minWidth: '180px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
  },
  item: {
    display: 'flex', alignItems: 'center', padding: '6px 12px',
    borderRadius: '4px', cursor: 'pointer', fontSize: '14px', color: '#e8eaed',
  },
  icon: { width: '24px', textAlign: 'center' as const, marginRight: '8px', flexShrink: 0 },
  label: { flex: 1 },
  shortcut: { fontSize: '11px', color: '#888', marginLeft: '16px' },
};
