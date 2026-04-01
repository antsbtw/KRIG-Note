import { useState, useEffect, useCallback } from 'react';
import type { EditorView } from 'prosemirror-view';
import { blockRegistry } from '../registry';
import { blockAction } from '../block-ops/block-action';

/**
 * HandleMenu — Block 操作菜单
 *
 * 点击 Block 左侧手柄后弹出。
 * 菜单项从当前 Block 的 capabilities + customActions 派生。
 */

interface HandleMenuProps {
  view: EditorView | null;
}

interface MenuState {
  open: boolean;
  pos: number;
  blockType: string;
  coords: { left: number; top: number };
}

export function HandleMenu({ view }: HandleMenuProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    if (!view) return;

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setMenu({
        open: true,
        pos: detail.pos,
        blockType: detail.blockType,
        coords: detail.coords,
      });
    };

    view.dom.addEventListener('block-handle-click', handler);

    // 点击其他地方关闭
    const closeHandler = () => setMenu(null);
    document.addEventListener('click', closeHandler);

    return () => {
      view.dom.removeEventListener('block-handle-click', handler);
      document.removeEventListener('click', closeHandler);
    };
  }, [view]);

  if (!menu?.open || !view) return null;

  const blockDef = blockRegistry.get(menu.blockType);
  const capabilities = blockDef?.capabilities;
  const customActions = blockDef?.customActions ?? [];

  // 构建菜单项
  const items: { id: string; label: string; icon: string; shortcut?: string; action: () => void }[] = [];

  // Fold/Unfold（heading 专属）
  if (menu.blockType === 'heading') {
    const node = view.state.doc.nodeAt(menu.pos);
    const isOpen = node?.attrs.open !== false;
    items.push({
      id: 'fold-toggle',
      label: isOpen ? 'Fold' : 'Unfold',
      icon: isOpen ? '▸' : '▾',
      shortcut: '⌘.',
      action: () => {
        const currentNode = view.state.doc.nodeAt(menu.pos);
        if (currentNode) {
          view.dispatch(
            view.state.tr.setNodeMarkup(menu.pos, undefined, {
              ...currentNode.attrs,
              open: !isOpen,
            }),
          );
        }
        setMenu(null);
      },
    });
  }

  // turnInto 选项
  if (capabilities?.turnInto && capabilities.turnInto.length > 0) {
    for (const target of capabilities.turnInto) {
      const targetDef = blockRegistry.get(target);
      items.push({
        id: `turn-${target}`,
        label: `Turn into ${targetDef?.slashMenu?.label ?? target}`,
        icon: targetDef?.slashMenu?.icon ?? '↺',
        action: () => {
          blockAction.turnInto(view, menu.pos, target);
          setMenu(null);
        },
      });
    }
  }

  // 通用操作
  if (capabilities?.canDelete) {
    items.push({
      id: 'delete',
      label: 'Delete',
      icon: '🗑',
      action: () => {
        blockAction.delete(view, menu.pos);
        setMenu(null);
      },
    });
  }

  // Block 专有操作
  for (const action of customActions) {
    if (!action.showIn || action.showIn.includes('handleMenu')) {
      items.push({
        id: action.id,
        label: action.label,
        icon: action.icon ?? '•',
        action: () => {
          action.handler(view, menu.pos);
          setMenu(null);
        },
      });
    }
  }

  if (items.length === 0) return null;

  return (
    <div
      style={{
        ...styles.container,
        left: menu.coords.left,
        top: menu.coords.top + 4,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <div
          key={item.id}
          style={styles.item}
          onMouseDown={(e) => {
            e.preventDefault();
            item.action();
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#3a3a3a')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <span style={styles.icon}>{item.icon}</span>
          <span style={styles.label}>{item.label}</span>
          {item.shortcut && <span style={styles.shortcut}>{item.shortcut}</span>}
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
    minWidth: '180px',
    maxHeight: '300px',
    overflow: 'auto',
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
