import { useState, useEffect, useCallback, useMemo } from 'react';
import type { EditorView } from 'prosemirror-view';
import { setBlockType } from 'prosemirror-commands';
import { blockRegistry } from '../registry';
import { slashCommandKey, type SlashCommandState } from '../plugins/slash-command';

/**
 * SlashMenu — Slash 命令菜单
 *
 * 从 BlockRegistry 自动生成菜单项。
 * 用户输入 `/` 后显示，选择一项后创建对应 Block。
 */

interface SlashMenuProps {
  view: EditorView | null;
}

export function SlashMenu({ view }: SlashMenuProps) {
  const [state, setState] = useState<SlashCommandState | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // 从 BlockRegistry 自动生成菜单项
  const allItems = useMemo(() => blockRegistry.buildSlashItems(), []);

  // 根据 query 过滤
  const filteredItems = useMemo(() => {
    if (!state?.query) return allItems;
    const q = state.query.toLowerCase();
    return allItems.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.keywords?.some((k) => k.toLowerCase().includes(q)),
    );
  }, [allItems, state?.query]);

  // 监听编辑器状态变化
  useEffect(() => {
    if (!view) return;

    const updateHandler = () => {
      const pluginState = slashCommandKey.getState(view.state) as SlashCommandState | undefined;
      setState(pluginState?.active ? pluginState : null);
      setSelectedIndex(0);
    };

    // 用 MutationObserver 检测 DOM 变化（ProseMirror 更新后触发）
    const observer = new MutationObserver(updateHandler);
    observer.observe(view.dom, { childList: true, subtree: true, characterData: true });

    // 初始检查
    updateHandler();

    return () => observer.disconnect();
  }, [view]);

  // 执行选择
  const executeItem = useCallback(
    (itemId: string) => {
      if (!view || !state) return;

      const { from, to } = state;

      // 关闭菜单
      const tr = view.state.tr;
      tr.setMeta(slashCommandKey, { close: true });

      // 删除 `/query` 文本
      tr.delete(from, to);
      view.dispatch(tr);

      // 执行 Block 创建
      const blockDef = blockRegistry.get(itemId);
      if (blockDef) {
        const schema = view.state.schema;
        const nodeType = schema.nodes[itemId];
        if (nodeType) {
          setBlockType(nodeType)(view.state, view.dispatch);
        }
      }

      view.focus();
    },
    [view, state],
  );

  // 键盘导航
  useEffect(() => {
    if (!view || !state) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!state) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filteredItems.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredItems[selectedIndex]) {
          executeItem(filteredItems[selectedIndex].id);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        const tr = view.state.tr;
        tr.setMeta(slashCommandKey, { close: true });
        view.dispatch(tr);
      }
    };

    view.dom.addEventListener('keydown', handleKeyDown);
    return () => view.dom.removeEventListener('keydown', handleKeyDown);
  }, [view, state, filteredItems, selectedIndex, executeItem]);

  if (!state?.active || !state.coords || filteredItems.length === 0) return null;

  return (
    <div
      style={{
        ...styles.container,
        left: state.coords.left,
        top: state.coords.bottom + 4,
      }}
    >
      {filteredItems.map((item, index) => (
        <div
          key={item.id}
          style={{
            ...styles.item,
            ...(index === selectedIndex ? styles.itemSelected : {}),
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            executeItem(item.id);
          }}
          onMouseEnter={() => setSelectedIndex(index)}
        >
          <span style={styles.icon}>{item.icon || '•'}</span>
          <span style={styles.label}>{item.label}</span>
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
    minWidth: '200px',
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
  itemSelected: {
    background: '#3a3a3a',
  },
  icon: {
    fontSize: '14px',
    width: '24px',
    textAlign: 'center',
    color: '#999',
  },
  label: {},
};
