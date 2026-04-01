import { useState, useEffect } from 'react';
import type { EditorView } from 'prosemirror-view';

/**
 * ContextMenu — 右键菜单
 *
 * 只提供剪贴板操作（Cut/Copy/Paste）。
 * Block 操作在 Handle 中，不在右键菜单。
 * 打开时通知父组件（用于互斥关闭 FloatingToolbar）。
 */

interface ContextMenuProps {
  view: EditorView | null;
  onOpen?: () => void;
  onClose?: () => void;
}

interface MenuState {
  coords: { left: number; top: number };
}

export function ContextMenu({ view, onOpen, onClose }: ContextMenuProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    if (!view) return;

    const handler = (e: MouseEvent) => {
      e.preventDefault();
      setMenu({ coords: { left: e.clientX, top: e.clientY } });
      onOpen?.();
    };

    view.dom.addEventListener('contextmenu', handler);

    const closeHandler = () => {
      setMenu(null);
      onClose?.();
    };
    document.addEventListener('click', closeHandler);

    return () => {
      view.dom.removeEventListener('contextmenu', handler);
      document.removeEventListener('click', closeHandler);
    };
  }, [view, onOpen, onClose]);

  if (!menu || !view) return null;

  const close = () => { setMenu(null); onClose?.(); };

  const items = [
    {
      id: 'cut', label: 'Cut', icon: '✂', shortcut: '⌘X',
      action: () => {
        document.execCommand('cut');
        close();
      },
    },
    {
      id: 'copy', label: 'Copy', icon: '📋', shortcut: '⌘C',
      action: () => {
        document.execCommand('copy');
        close();
      },
    },
    {
      id: 'paste', label: 'Paste', icon: '📄', shortcut: '⌘V',
      action: async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (text && view) {
            const { state } = view;
            const tr = state.tr.insertText(text);
            view.dispatch(tr);
          }
        } catch {
          // fallback
          document.execCommand('paste');
        }
        close();
      },
    },
  ];

  return (
    <div
      style={{ ...styles.container, left: menu.coords.left, top: menu.coords.top }}
      onClick={(e) => e.stopPropagation()}
    >
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
    position: 'fixed',
    zIndex: 1000,
    background: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: '8px',
    padding: '4px',
    minWidth: '160px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 10px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    color: '#e8eaed',
  },
  icon: {
    fontSize: '14px',
    width: '20px',
    textAlign: 'center',
    color: '#999',
  },
  label: {
    flex: 1,
  },
  shortcut: {
    fontSize: '11px',
    color: '#666',
  },
};
