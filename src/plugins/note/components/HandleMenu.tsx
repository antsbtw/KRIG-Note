import { useState, useEffect, useCallback } from 'react';
import type { EditorView } from 'prosemirror-view';
import { blockRegistry } from '../registry';

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
  const items: { id: string; label: string; icon: string; action: () => void }[] = [];

  // turnInto 选项
  if (capabilities?.turnInto && capabilities.turnInto.length > 0) {
    for (const target of capabilities.turnInto) {
      const targetDef = blockRegistry.get(target);
      items.push({
        id: `turn-${target}`,
        label: `Turn into ${targetDef?.slashMenu?.label ?? target}`,
        icon: targetDef?.slashMenu?.icon ?? '↺',
        action: () => {
          // TODO: 实现 turnInto
          console.log(`turnInto ${target} at pos ${menu.pos}`);
          setMenu(null);
        },
      });
    }
  }

  // 通用操作
  if (capabilities?.canDuplicate) {
    items.push({
      id: 'duplicate',
      label: 'Duplicate',
      icon: '⊕',
      action: () => {
        // TODO: 实现复制
        console.log(`duplicate at pos ${menu.pos}`);
        setMenu(null);
      },
    });
  }

  if (capabilities?.canDelete) {
    items.push({
      id: 'delete',
      label: 'Delete',
      icon: '🗑',
      action: () => {
        const { state } = view;
        const $pos = state.doc.resolve(menu.pos);
        const node = $pos.nodeAfter;
        if (node) {
          const tr = state.tr.delete(menu.pos, menu.pos + node.nodeSize);
          view.dispatch(tr);
        }
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
          <span>{item.label}</span>
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
};
