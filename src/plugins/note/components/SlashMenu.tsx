import { useState, useEffect, useCallback, useMemo } from 'react';
import type { EditorView } from 'prosemirror-view';
import { setBlockType } from 'prosemirror-commands';
import { TextSelection } from 'prosemirror-state';
import { blockRegistry } from '../registry';
import { triggerNotePicker } from './NotePicker';
import { slashCommandKey, type SlashCommandState } from '../plugins/slash-command';

/**
 * SlashMenu — Slash 命令菜单
 *
 * 从 BlockRegistry 自动生成菜单项。
 * 键盘导航由 slashCommandPlugin 处理（Enter/Escape/方向键在 plugin 层拦截）。
 */

interface SlashMenuProps {
  view: EditorView | null;
}

export function SlashMenu({ view }: SlashMenuProps) {
  const [pluginState, setPluginState] = useState<SlashCommandState | null>(null);

  // 不缓存——每次都从 registry 读取（确保动态注册的 Block 能被发现）
  const allItems = blockRegistry.buildSlashItems();

  const filteredItems = useMemo(() => {
    if (!pluginState?.query) return allItems;
    const q = pluginState.query.toLowerCase();
    return allItems.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.keywords?.some((k) => k.toLowerCase().includes(q)),
    );
  }, [allItems, pluginState?.query]);

  // 同步 itemCount 到 plugin state
  useEffect(() => {
    if (!view || !pluginState?.active) return;
    if (pluginState.itemCount !== filteredItems.length) {
      view.dispatch(view.state.tr.setMeta(slashCommandKey, { setItemCount: filteredItems.length }));
    }
  }, [view, pluginState?.active, pluginState?.itemCount, filteredItems.length]);

  // 监听编辑器状态变化
  useEffect(() => {
    if (!view) return;

    const update = () => {
      const state = slashCommandKey.getState(view.state) as SlashCommandState | undefined;
      setPluginState(state?.active ? state : null);
    };

    const observer = new MutationObserver(update);
    observer.observe(view.dom, { childList: true, subtree: true, characterData: true });

    // 也监听 selectionchange
    const selHandler = () => requestAnimationFrame(update);
    document.addEventListener('selectionchange', selHandler);

    update();

    return () => {
      observer.disconnect();
      document.removeEventListener('selectionchange', selHandler);
    };
  }, [view]);

  // 执行选中项
  const executeItem = useCallback(
    (itemId: string) => {
      if (!view || !pluginState) return;

      const { from, to } = pluginState;
      const schema = view.state.schema;

      // 检查是否为额外注册的 SlashMenu 项（如 heading1 → heading + {level:1}）
      const extraItem = blockRegistry.getExtraSlashItem(itemId);
      const actualBlockName = extraItem?.blockName ?? itemId;
      const extraAttrs = extraItem?.attrs;

      const blockDef = blockRegistry.get(actualBlockName);
      const nodeType = schema.nodes[actualBlockName];
      if (!nodeType) return;

      // 关闭菜单 + 删除 /query 文本
      let tr = view.state.tr;
      tr.setMeta(slashCommandKey, { close: true });
      tr.delete(from, to);
      view.dispatch(tr);

      // groupType 项 → 修改当前 textBlock 的 attrs（不创建新节点）
      if (actualBlockName === 'textBlock' && extraAttrs?.groupType) {
        const { $from } = view.state.selection;
        const depth = $from.depth;
        const blockPos = $from.before(depth);
        const blockNode = view.state.doc.nodeAt(blockPos);
        if (blockNode?.type.name === 'textBlock') {
          const newGroupType = extraAttrs.groupType as string;
          const currentGroupType = blockNode.attrs.groupType as string | null;
          const currentIndent = (blockNode.attrs.indent as number) || 0;

          // 如果当前 block 已有不同的 groupType → 嵌套，indent+1
          const indent = (currentGroupType && currentGroupType !== newGroupType)
            ? currentIndent + 1
            : currentIndent;

          view.dispatch(view.state.tr.setNodeMarkup(blockPos, undefined, {
            ...blockNode.attrs,
            ...extraAttrs,
            indent,
          }));
        }
        view.focus();
        return;
      }

      // noteLink → 打开 NotePicker 面板（不直接插入节点）
      if (actualBlockName === 'noteLink') {
        triggerNotePicker(view);
        view.focus();
        return;
      }

      // 根据 Block 类型创建节点
      // mathInline → 插入 inline atom 节点
      if (actualBlockName === 'mathInline') {
        const mathNode = nodeType.create({ latex: '' });
        view.dispatch(view.state.tr.replaceSelectionWith(mathNode));
        view.focus();
        // 触发点击编辑
        setTimeout(() => {
          const dom = view.dom.querySelector('.math-inline:last-of-type') as HTMLElement;
          dom?.click();
        }, 50);
        return;
      }

      const needsStructure = blockDef?.containerRule !== undefined
        || blockDef?.nodeSpec.content?.includes('block')
        || actualBlockName === 'image'
        || actualBlockName === 'table'
        || actualBlockName === 'mathBlock'
        || actualBlockName === 'audioBlock'
        || actualBlockName === 'videoBlock'
        || actualBlockName === 'tweetBlock';
      if (needsStructure) {
        // Container 类型（toggleHeading, toggleList, blockquote 等）
        // 替换光标所在的 paragraph（可能在嵌套容器内部）
        const { $from } = view.state.selection;
        // 找到最内层的 block 节点（通常是 paragraph/textBlock）
        const depth = $from.depth;
        const blockStart = $from.before(depth);
        const blockEnd = $from.after(depth);

        let containerNode;
        if (actualBlockName === 'toggleHeading') {
          // toggleHeading: heading(空) + paragraph(空)
          containerNode = nodeType.create(
            { open: true },
            [schema.nodes.textBlock.create({ level: 2 }), schema.nodes.textBlock.create()],
          );
        } else if (actualBlockName === 'toggleList') {
          // toggleList: paragraph(空)
          containerNode = nodeType.create(
            { open: true },
            [schema.nodes.textBlock.create()],
          );
        } else if (actualBlockName === 'blockquote') {
          // blockquote: paragraph(空)
          containerNode = nodeType.create(null, [schema.nodes.textBlock.create()]);
        } else if (actualBlockName === 'bulletList' || actualBlockName === 'orderedList' || actualBlockName === 'taskList') {
          // 列表 Container: textBlock(空)
          containerNode = nodeType.create(extraAttrs ?? null, [schema.nodes.textBlock.create()]);
        } else if (actualBlockName === 'callout') {
          // 提示框: paragraph
          containerNode = nodeType.create({ emoji: '💡' }, [schema.nodes.textBlock.create()]);
        } else if (actualBlockName === 'image') {
          // 图片: paragraph (caption)
          containerNode = nodeType.create({ src: null }, [schema.nodes.textBlock.create()]);
        } else if (actualBlockName === 'table') {
          // 表格 3×3: 1 header row + 2 data rows
          const cell = () => schema.nodes.tableCell.create(null, [schema.nodes.textBlock.create()]);
          const headerCell = () => schema.nodes.tableHeader.create(null, [schema.nodes.textBlock.create()]);
          const headerRow = schema.nodes.tableRow.create(null, [headerCell(), headerCell(), headerCell()]);
          const dataRow = () => schema.nodes.tableRow.create(null, [cell(), cell(), cell()]);
          containerNode = nodeType.create(null, [headerRow, dataRow(), dataRow()]);
        } else if (actualBlockName === 'mathBlock') {
          // 数学公式块
          containerNode = nodeType.create({ latex: '' });
        } else if (actualBlockName === 'columnList') {
          // 多列布局
          const col = () => schema.nodes.column.create(null, [schema.nodes.textBlock.create()]);
          const colCount = (extraAttrs?.columns as number) || 2;
          const cols = Array.from({ length: colCount }, () => col());
          containerNode = nodeType.create({ columns: colCount }, cols);
        } else if (actualBlockName === 'audioBlock') {
          containerNode = nodeType.create({ src: null }, [schema.nodes.textBlock.create()]);
        } else if (actualBlockName === 'videoBlock') {
          containerNode = nodeType.create({ src: null }, [schema.nodes.textBlock.create()]);
        } else if (actualBlockName === 'tweetBlock') {
          containerNode = nodeType.create({ tweetUrl: null }, [schema.nodes.textBlock.create()]);
        } else {
          // 通用 Container
          containerNode = nodeType.create(null, [schema.nodes.textBlock.create()]);
        }

        const replaceTr = view.state.tr.replaceWith(blockStart, blockEnd, containerNode);
        // 光标放到容器内第一个可编辑位置（用 near 自动查找）
        const $pos = replaceTr.doc.resolve(blockStart + 1);
        replaceTr.setSelection(TextSelection.near($pos));
        view.dispatch(replaceTr);
      } else if (nodeType.spec.content === 'text*' || actualBlockName === 'codeBlock') {
        // 纯文本 Block（codeBlock）— 传 extraAttrs（如 language: 'mermaid'）
        const { $from } = view.state.selection;
        const depth = $from.depth;
        const blockStart = $from.before(depth);
        const blockEnd = $from.after(depth);
        const newNode = nodeType.create(extraAttrs || undefined);
        const replaceTr = view.state.tr.replaceWith(blockStart, blockEnd, newNode);
        const resolvedPos = replaceTr.doc.resolve(blockStart + 1);
        replaceTr.setSelection(TextSelection.near(resolvedPos));
        view.dispatch(replaceTr);
      } else if (actualBlockName === 'horizontalRule') {
        // 分割线：插入 hr + 新 paragraph
        const { $from } = view.state.selection;
        const depth = $from.depth;
        const blockStart = $from.before(depth);
        const blockEnd = $from.after(depth);
        const hr = nodeType.create();
        const newParagraph = schema.nodes.textBlock.create();
        const replaceTr = view.state.tr.replaceWith(blockStart, blockEnd, [hr, newParagraph]);
        const resolvedPos = replaceTr.doc.resolve(blockStart + hr.nodeSize + 1);
        replaceTr.setSelection(TextSelection.near(resolvedPos));
        view.dispatch(replaceTr);
      } else {
        // 简单 Block（paragraph, heading 等）— setBlockType + 额外 attrs
        setBlockType(nodeType, extraAttrs || undefined)(view.state, view.dispatch);
      }

      view.focus();
    },
    [view, pluginState],
  );

  // 监听 plugin 的 execute 事件
  useEffect(() => {
    if (!view) return;

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const item = filteredItems[detail.selectedIndex];
      if (item) executeItem(item.id);
    };

    view.dom.addEventListener('slash-execute', handler);
    return () => view.dom.removeEventListener('slash-execute', handler);
  }, [view, filteredItems, executeItem]);

  // 点击菜单外关闭
  useEffect(() => {
    if (!view || !pluginState?.active) return;

    const clickOutside = (e: MouseEvent) => {
      // 如果点击的是菜单内部，不关闭
      const target = e.target as HTMLElement;
      if (target.closest('.slash-menu')) return;

      // 删除 / 字符并关闭
      const { from, to } = pluginState;
      const tr = view.state.tr;
      tr.delete(from, to);
      tr.setMeta(slashCommandKey, { close: true });
      view.dispatch(tr);
      view.focus();
    };

    // 延迟绑定，避免当前点击触发
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', clickOutside);
    }, 50);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', clickOutside);
    };
  }, [view, pluginState?.active, pluginState?.from, pluginState?.to]);

  if (!pluginState?.active || !pluginState.coords || filteredItems.length === 0) return null;

  const selectedIndex = pluginState.selectedIndex;

  return (
    <div
      className="slash-menu"
      style={{
        ...styles.container,
        left: pluginState.coords.left,
        top: pluginState.coords.bottom + 4,
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
          onMouseEnter={() => {
            if (view) {
              view.dispatch(view.state.tr.setMeta(slashCommandKey, { setSelectedIndex: index }));
            }
          }}
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
