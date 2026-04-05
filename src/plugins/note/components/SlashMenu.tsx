import { useState, useEffect, useRef } from 'react';
import type { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import { slashCommandKey } from '../plugins/slash-command';
import { blockRegistry } from '../registry';

/**
 * SlashMenu — / 命令菜单
 *
 * 显示所有可用 Block，输入过滤，Enter 选择。
 */

interface SlashMenuProps {
  view: EditorView | null;
}

export function SlashMenu({ view }: SlashMenuProps) {
  const [items, setItems] = useState<{ id: string; label: string; icon: string; blockName: string; attrs?: Record<string, unknown> }[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!view) return;

    const update = () => {
      const state = slashCommandKey.getState(view.state);
      if (!state?.active) {
        setCoords(null);
        return;
      }

      // 过滤候选项
      const query = state.query.toLowerCase();
      const allItems = blockRegistry.getSlashItems().map((item) => ({
        id: item.id,
        label: item.label,
        icon: item.icon,
        blockName: item.blockName,
        attrs: item.attrs,
        order: item.order,
        keywords: item.keywords,
      }));

      const filtered = allItems
        .filter((item) => {
          if (!query) return true;
          return item.label.toLowerCase().includes(query)
            || item.keywords.some((k) => k.includes(query));
        })
        .sort((a, b) => a.order - b.order);

      setItems(filtered);
      setSelectedIdx(0);

      // 定位菜单
      try {
        const coordsAt = view.coordsAtPos(state.from);
        setCoords({ left: coordsAt.left, top: coordsAt.bottom + 4 });
      } catch {
        setCoords(null);
      }
    };

    // 监听编辑器状态变化
    const origDispatch = view.dispatch.bind(view);
    view.dispatch = (tr) => {
      origDispatch(tr);
      setTimeout(update, 0);
    };

    // 键盘导航
    const keyHandler = (e: KeyboardEvent) => {
      const state = slashCommandKey.getState(view.state);
      if (!state?.active) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((prev) => Math.min(prev + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (items[selectedIdx]) executeItem(items[selectedIdx]);
      }
    };

    view.dom.addEventListener('keydown', keyHandler);
    return () => {
      view.dom.removeEventListener('keydown', keyHandler);
    };
  }, [view, items, selectedIdx]);

  function executeItem(item: { blockName: string; attrs?: Record<string, unknown> }) {
    if (!view) return;

    const state = slashCommandKey.getState(view.state);
    if (!state) return;

    const { from, to } = state;
    const schema = view.state.schema;
    const nodeType = schema.nodes[item.blockName];
    if (!nodeType) return;

    // 关闭菜单 + 删除 /query
    let tr = view.state.tr;
    tr.setMeta(slashCommandKey, { close: true });
    tr.delete(from, to);
    view.dispatch(tr);

    // 获取替换位置
    const { $from } = view.state.selection;
    const depth = $from.depth;
    const blockStart = $from.before(depth);
    const blockEnd = $from.after(depth);

    const blockDef = blockRegistry.get(item.blockName);
    const isContainer = blockDef?.containerRule !== undefined;
    const hasBlockContent = blockDef?.nodeSpec.content?.includes('block');
    const isAtom = blockDef?.nodeSpec.atom;

    let containerNode;

    if (item.blockName === 'textBlock' && item.attrs) {
      // TextBlock 变体（heading 等）→ 修改 attrs
      const node = view.state.doc.nodeAt(blockStart);
      if (node?.type.name === 'textBlock') {
        view.dispatch(view.state.tr.setNodeMarkup(blockStart, undefined, { ...node.attrs, ...item.attrs }));
      }
      view.focus();
      return;
    } else if (item.blockName === 'mathInline') {
      // Inline atom → 插入到当前位置
      const mathNode = nodeType.create({ latex: '' });
      view.dispatch(view.state.tr.replaceSelectionWith(mathNode));
      view.focus();
      return;
    } else if (item.blockName === 'taskList') {
      const nowISO = new Date().toISOString();
      const taskItem = schema.nodes.taskItem.create(
        { createdAt: nowISO },
        [schema.nodes.textBlock.create()],
      );
      containerNode = nodeType.create(null, [taskItem]);
    } else if (item.blockName === 'toggleHeading') {
      containerNode = nodeType.create({ open: true }, [
        schema.nodes.textBlock.create({ level: 2 }),
        schema.nodes.textBlock.create(),
      ]);
    } else if (item.blockName === 'table') {
      const cell = () => schema.nodes.tableCell.create(null, [schema.nodes.textBlock.create()]);
      const header = () => schema.nodes.tableHeader.create(null, [schema.nodes.textBlock.create()]);
      containerNode = nodeType.create(null, [
        schema.nodes.tableRow.create(null, [header(), header(), header()]),
        schema.nodes.tableRow.create(null, [cell(), cell(), cell()]),
        schema.nodes.tableRow.create(null, [cell(), cell(), cell()]),
      ]);
    } else if (item.blockName === 'columnList') {
      const col = () => schema.nodes.column.create(null, [schema.nodes.textBlock.create()]);
      const colCount = (item.attrs?.columns as number) || 2;
      containerNode = nodeType.create({ columns: colCount }, Array.from({ length: colCount }, col));
    } else if (isAtom) {
      containerNode = nodeType.create(item.attrs ?? null);
    } else if (nodeType.spec.content === 'text*' || item.blockName === 'codeBlock') {
      containerNode = nodeType.create(item.attrs ?? null);
    } else if (isContainer || hasBlockContent) {
      containerNode = nodeType.create(item.attrs ?? null, [schema.nodes.textBlock.create()]);
    } else {
      containerNode = nodeType.create(item.attrs ?? null);
    }

    if (containerNode) {
      const replaceTr = view.state.tr.replaceWith(blockStart, blockEnd, containerNode);
      const $pos = replaceTr.doc.resolve(blockStart + 1);
      replaceTr.setSelection(TextSelection.near($pos));
      view.dispatch(replaceTr);
    }

    view.focus();
  }

  if (!coords || items.length === 0) return null;

  return (
    <div ref={menuRef} style={{ ...styles.container, left: coords.left, top: coords.top }}>
      {items.map((item, i) => (
        <div
          key={item.id}
          style={{ ...styles.item, background: i === selectedIdx ? '#3a3a3a' : 'transparent' }}
          onMouseDown={(e) => { e.preventDefault(); executeItem(item); }}
          onMouseEnter={() => setSelectedIdx(i)}
        >
          <span style={styles.icon}>{item.icon}</span>
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
    overflowY: 'auto',
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 12px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    color: '#e8eaed',
  },
  icon: {
    width: '28px',
    fontSize: '16px',
    textAlign: 'center' as const,
    marginRight: '8px',
    flexShrink: 0,
  },
  label: { flex: 1 },
};
