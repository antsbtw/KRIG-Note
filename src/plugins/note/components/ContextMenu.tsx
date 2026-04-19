import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import type { EditorView } from 'prosemirror-view';
import { showDictionaryPanel, showTranslationPanel } from '../learning';
import { deleteCurrentBlock, deleteSelection } from '../commands/editor-commands';
import { THOUGHT_ACTION } from '../../thought/thought-protocol';
import { addThought } from '../commands/thought-commands';
import { openAskAIPanel } from './AskAIPanel';
import { getSelectionCache } from '../commands/selection-cache';

/**
 * ContextMenu — 右键菜单
 *
 * Cut / Copy / Paste + Delete + 添加标注 + 问 AI
 */

interface ContextMenuProps {
  view: EditorView | null;
}

interface MenuState {
  coords: { left: number; top: number };
  /** 右键打开时预计算的内容预览（此时选区可能还未被折叠） */
  contentPreview: string;
}

export function ContextMenu({ view }: ContextMenuProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // 主菜单位置（视口边界修正后的）
  const [adjustedCoords, setAdjustedCoords] = useState<{ left: number; top: number } | null>(null);

  // 菜单渲染后修正位置，防止超出视口
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) { setAdjustedCoords(null); return; }
    const el = menuRef.current;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let { left, top } = menu.coords;
    if (left + rect.width > window.innerWidth - pad) left = window.innerWidth - rect.width - pad;
    if (top + rect.height > window.innerHeight - pad) top = window.innerHeight - rect.height - pad;
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    setAdjustedCoords({ left, top });
  }, [menu]);

  useEffect(() => {
    if (!view) return;

    const handler = (e: MouseEvent) => {
      e.preventDefault();
      // 从选区缓存读取内容预览（在选区变化时已实时提取 Markdown）
      const cache = getSelectionCache();
      const contentPreview = cache?.markdown || '';
      setMenu({ coords: { left: e.clientX, top: e.clientY }, contentPreview });
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

  const items: { id: string; label: string; icon: string; shortcut?: string; separator?: boolean; action: () => void }[] = [
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
      action: () => {
        // execCommand('paste') 在 Electron contextIsolation 下不可用，
        // 改用 Clipboard API 读取文本后手动插入。
        navigator.clipboard.readText().then((text) => {
          if (!text || !view) return;
          view.focus();
          view.dispatch(view.state.tr.insertText(text).scrollIntoView());
        }).catch(() => {});
        close();
      },
    },
    {
      id: 'delete', label: 'Delete', icon: '🗑', shortcut: '⌫',
      action: () => { deleteCurrentBlock(view); close(); },
    },
  ];

  // Thought 标注：检测光标处是否有 thought mark 或 node attr
  const thoughtMarkType = view.state.schema.marks.thought;
  if (thoughtMarkType) {
    const $pos = view.state.selection.$from;
    // 检查 inline/block mark
    const thoughtMark = $pos.marks().find((m) => m.type === thoughtMarkType);
    if (thoughtMark) {
      const thoughtId = thoughtMark.attrs.thoughtId;
      items.push({
        id: 'remove-thought', label: '删除标注', icon: '💭', separator: true,
        action: () => {
          // 移除 mark
          const { tr, doc } = view.state;
          doc.descendants((node, pos) => {
            node.marks.forEach((mark) => {
              if (mark.type === thoughtMarkType && mark.attrs.thoughtId === thoughtId) {
                tr.removeMark(pos, pos + node.nodeSize, mark);
              }
            });
          });
          view.dispatch(tr);
          // 通知 Thought 面板删除
          const api = (window as any).viewAPI;
          if (api?.sendToOtherSlot) {
            api.sendToOtherSlot({
              protocol: 'note-thought',
              action: THOUGHT_ACTION.DELETE,
              payload: { thoughtId },
            });
          }
          // 删除 DB 记录
          if (api?.thoughtDelete) api.thoughtDelete(thoughtId);
          if (api?.getActiveNoteId && api?.thoughtUnrelate) {
            api.getActiveNoteId().then((noteId: string) => {
              if (noteId) api.thoughtUnrelate(noteId, thoughtId);
            });
          }
          close();
        },
      });
    }
    // 检查 node attr（image, codeBlock 等）
    for (let d = $pos.depth; d >= 0; d--) {
      const node = $pos.node(d);
      if (node.attrs.thoughtId) {
        const thoughtId = node.attrs.thoughtId;
        const nodePos = $pos.before(d);
        items.push({
          id: 'remove-thought-node', label: '删除标注', icon: '💭', separator: true,
          action: () => {
            view.dispatch(
              view.state.tr.setNodeMarkup(nodePos, undefined, { ...node.attrs, thoughtId: null }),
            );
            const api = (window as any).viewAPI;
            if (api?.sendToOtherSlot) {
              api.sendToOtherSlot({
                protocol: 'note-thought',
                action: THOUGHT_ACTION.DELETE,
                payload: { thoughtId },
              });
            }
            if (api?.thoughtDelete) api.thoughtDelete(thoughtId);
            if (api?.getActiveNoteId && api?.thoughtUnrelate) {
              api.getActiveNoteId().then((noteId: string) => {
                if (noteId) api.thoughtUnrelate(noteId, thoughtId);
              });
            }
            close();
          },
        });
        break;
      }
    }
  }

  // 学习模块：选中文本时显示查词/翻译
  const { from, to } = view.state.selection;
  const hasSelection = from !== to;
  if (hasSelection) {
    const selectedText = view.state.doc.textBetween(from, to, ' ').trim();
    if (selectedText) {
      const isWord = !/\s/.test(selectedText);
      const $from = view.state.selection.$from;
      const parentStart = $from.start($from.depth);
      const parentEnd = $from.end($from.depth);
      const contextSentence = view.state.doc.textBetween(parentStart, parentEnd, ' ');

      if (isWord) {
        items.push({
          id: 'lookup', label: '查词', icon: '📖', separator: true,
          action: () => { showDictionaryPanel(selectedText, contextSentence); close(); },
        });
      }
      items.push({
        id: 'translate', label: '翻译', icon: '🌐', separator: !isWord,
        action: () => { showTranslationPanel(selectedText); close(); },
      });
    }
  }

  // 标注 + 问 AI：有选区或光标在 block 中时可用
  const hasContent = hasSelection || view.state.selection.$from.parent.content.size > 0;
  if (hasContent) {
    // "添加标注" — 一键执行，默认"思考"类型，后续在 ThoughtView 中调整
    items.push({
      id: 'add-thought', label: '添加标注', icon: '💭', separator: true,
      action: () => { addThought(view); close(); },
    });

    // "问 AI" — 收起菜单，弹出独立浮窗
    items.push({
      id: 'ask-ai', label: '问 AI', icon: '🤖',
      action: () => {
        const { coords, contentPreview } = menu;
        close();
        openAskAIPanel(view, coords, contentPreview);
      },
    });
  }

  const pos = adjustedCoords || menu.coords;

  return (
    <div ref={menuRef} style={{ ...styles.container, left: pos.left, top: pos.top }} onClick={(e) => e.stopPropagation()}>
      {items.map((item) => (
        <div key={item.id}>
          {item.separator && <div style={styles.separator} />}
          <div
            style={styles.item}
            onMouseDown={(e) => { e.preventDefault(); item.action(); }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#3a3a3a';
            }}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <span style={styles.icon}>{item.icon}</span>
            <span style={styles.label}>{item.label}</span>
            {item.shortcut && <span style={styles.shortcut}>{item.shortcut}</span>}
          </div>
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
  separator: { height: '1px', background: '#444', margin: '4px 8px' },
};
