import { useState, useEffect } from 'react';
import type { EditorView } from 'prosemirror-view';
import { blockAction } from '../block-ops/block-action';
import { blockSelectionKey } from '../block-ops/block-selection';

/**
 * ContextMenu — 智能右键菜单
 *
 * 混合菜单：同时支持文字操作和 Block 操作。
 * Cut/Copy/Paste 智能判断（有 Block 选中 = Block 级，否则 = 文字级）。
 * Block 选中时额外显示 Delete / Indent / Outdent。
 */

interface ContextMenuProps {
  view: EditorView | null;
  onOpen?: () => void;
  onClose?: () => void;
}

interface MenuState {
  coords: { left: number; top: number };
  blockSelected: boolean;
  hasLink: boolean;
  linkPos: { from: number; to: number } | null;
}

export function ContextMenu({ view, onOpen, onClose }: ContextMenuProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    if (!view) return;

    const handler = (e: MouseEvent) => {
      e.preventDefault();
      const selState = blockSelectionKey.getState(view.state);

      // 检测右键位置是否有 link mark
      let hasLink = false;
      let linkPos: { from: number; to: number } | null = null;
      const pos = view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (pos) {
        const $pos = view.state.doc.resolve(pos.pos);
        const linkMark = $pos.marks().find((m) => m.type.name === 'link');
        if (linkMark) {
          hasLink = true;
          // 找 link mark 覆盖的范围
          const from = pos.pos;
          let start = from;
          let end = from;
          const parent = $pos.parent;
          const parentStart = $pos.start();
          parent.forEach((node, offset) => {
            const nodeFrom = parentStart + offset;
            const nodeTo = nodeFrom + node.nodeSize;
            if (nodeFrom <= from && from < nodeTo && node.marks.some((m) => m.type.name === 'link')) {
              start = nodeFrom;
              end = nodeTo;
            }
          });
          linkPos = { from: start, to: end };
        }
      }

      setMenu({
        coords: { left: e.clientX, top: e.clientY },
        blockSelected: (selState?.active && selState.positions.length > 0) || false,
        hasLink,
        linkPos,
      });
      onOpen?.();
    };

    view.dom.addEventListener('contextmenu', handler);

    const closeHandler = () => { setMenu(null); onClose?.(); };
    document.addEventListener('click', closeHandler);

    return () => {
      view.dom.removeEventListener('contextmenu', handler);
      document.removeEventListener('click', closeHandler);
    };
  }, [view, onOpen, onClose]);

  if (!menu || !view) return null;

  const close = () => { setMenu(null); onClose?.(); };

  type MenuItem = { id: string; label: string; icon: string; shortcut: string; separator?: boolean; action: () => void };
  const items: MenuItem[] = [];

  // 剪贴板操作（智能）
  items.push({
    id: 'cut', label: 'Cut', icon: '✂', shortcut: '⌘X',
    action: () => {
      if (menu.blockSelected) { blockAction.cut(view); } else { document.execCommand('cut'); }
      close();
    },
  });

  items.push({
    id: 'copy', label: 'Copy', icon: '📋', shortcut: '⌘C',
    action: () => {
      if (menu.blockSelected) { blockAction.copy(view); } else { document.execCommand('copy'); }
      close();
    },
  });

  items.push({
    id: 'paste', label: 'Paste', icon: '📄', shortcut: '⌘V',
    action: async () => {
      if (blockAction.hasClipboard()) {
        const { $from } = view.state.selection;
        const blockPos = $from.depth >= 1 ? $from.after(1) : $from.pos;
        blockAction.paste(view, blockPos);
      } else {
        try {
          const text = await navigator.clipboard.readText();
          if (text) view.dispatch(view.state.tr.insertText(text));
        } catch { document.execCommand('paste'); }
      }
      close();
    },
  });

  // 链接操作
  if (menu.hasLink && menu.linkPos) {
    items.push({ id: 'sep-link', label: '', icon: '', shortcut: '', separator: true, action: () => {} });
    items.push({
      id: 'remove-link', label: '移除链接', icon: '🔗', shortcut: '',
      action: () => {
        const linkMark = view.state.schema.marks.link;
        if (linkMark && menu.linkPos) {
          view.dispatch(view.state.tr.removeMark(menu.linkPos.from, menu.linkPos.to, linkMark));
        }
        close();
      },
    });
  }

  // Block 选中时的额外操作
  if (menu.blockSelected) {
    items.push({ id: 'sep1', label: '', icon: '', shortcut: '', separator: true, action: () => {} });

    items.push({
      id: 'delete', label: 'Delete', icon: '🗑', shortcut: '⌫',
      action: () => { blockAction.deleteSelected(view); close(); },
    });

    items.push({
      id: 'indent', label: 'Indent', icon: '→', shortcut: 'Tab',
      action: () => {
        const state = blockSelectionKey.getState(view.state);
        if (state?.positions[0] !== undefined) blockAction.indent(view, state.positions[0]);
        close();
      },
    });

    items.push({
      id: 'outdent', label: 'Outdent', icon: '←', shortcut: '⇧Tab',
      action: () => {
        const state = blockSelectionKey.getState(view.state);
        if (state?.positions[0] !== undefined) blockAction.outdent(view, state.positions[0]);
        close();
      },
    });
  }

  return (
    <div
      style={{ ...styles.container, left: menu.coords.left, top: menu.coords.top }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item) =>
        item.separator ? (
          <div key={item.id} style={styles.separator} />
        ) : (
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
        ),
      )}
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
    minWidth: '180px',
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
  icon: { fontSize: '14px', width: '20px', textAlign: 'center', color: '#999' },
  label: { flex: 1 },
  shortcut: { fontSize: '11px', color: '#666' },
  separator: { height: '1px', background: '#444', margin: '4px 8px' },
};
