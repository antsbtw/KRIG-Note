import { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history, undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { columnResizing } from 'prosemirror-tables';

// 复用 NoteView 的 schema + 全套 plugins
import { blockRegistry } from '../../note/registry';
import { buildInputRules } from '../../note/plugins/input-rules';
import { containerKeyboardPlugin } from '../../note/plugins/container-keyboard';
import { slashCommandPlugin } from '../../note/plugins/slash-command';
import { linkClickPlugin } from '../../note/plugins/link-click';
import { blockHandlePlugin } from '../../note/plugins/block-handle';
import { blockSelectionPlugin } from '../../note/plugins/block-selection';
import { indentPlugin } from '../../note/plugins/indent';
import { pasteMediaPlugin } from '../../note/plugins/paste-media';
import { smartPastePlugin } from '../../note/paste/smart-paste-plugin';
import { renderBlockFocusPlugin } from '../../note/plugins/render-block-focus';
import { headingCollapsePlugin } from '../../note/plugins/heading-collapse';
import { columnCollapsePlugin } from '../../note/plugins/column-collapse';
import { blockFramePlugin } from '../../note/plugins/block-frame';

// 复用 4 大 React UI（spec v1.2 § 6.3）
import { SlashMenu } from '../../note/components/SlashMenu';
import { FloatingToolbar } from '../../note/components/FloatingToolbar';
import { HandleMenu } from '../../note/components/HandleMenu';
import { ContextMenu } from '../../note/components/ContextMenu';

import { getNodeContentSchema } from '../engines/NodeContentRenderer';
import type { Atom } from '../engines/GraphEngine';

// 复用 NoteView 的 CSS（block 渲染、SlashMenu 等 UI 样式）
import '../../note/note.css';
// 节点 label 的紧凑样式覆盖（避免 note.css 的 .ProseMirror 把 label 撑大）
import '../graph.css';

/**
 * NodeEditorPopup — 节点 / 边的 ProseMirror 编辑器浮窗（spec v1.2 § 7.2）
 *
 * 复用 NoteView 的 schema + 大部分 plugins + 4 个 React UI（SlashMenu /
 * FloatingToolbar / HandleMenu / ContextMenu），用户在节点 label 中得到
 * **和 NoteView 一致的编辑体验**。
 *
 * 不复用：
 * - NoteEditor 组件本身（绑定 noteId 数据流）
 * - thoughtPlugin / titleGuard（graph 没有 thought 锚点 / noteTitle）
 * - vocabHighlight / fromPageDecoration（graph 不需要这些 note 特定功能）
 * - AskAIPanel（依赖 Note 的 AI 流程）
 *
 * 注意：HandleMenu 内会引用 addThought / askAI 等 note 特有命令，graph 上下文
 *   下用户点击这些项可能 noop 或失败，但不影响编辑器主体功能。后续按需评估
 *   "graph 友好的菜单变体"。
 */

interface OpenEditorOptions {
  /** 锚点 DOM（label 容器），用于计算弹窗位置 */
  anchor: HTMLElement;
  /** 初始 atom 数组 */
  initial: Atom[];
  /** 提交时回调（Cmd+Enter / 失焦 / 点击外部） */
  onCommit: (next: Atom[]) => void;
  /** 取消时回调（Esc） */
  onCancel?: () => void;
}

/**
 * 打开节点/边编辑器弹窗。返回 dispose 函数（一般无需主动调）。
 */
export function openNodeEditor(options: OpenEditorOptions): () => void {
  // 确保 blockRegistry 已注册（getNodeContentSchema 内部已处理一次性注册）
  getNodeContentSchema();

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    root.unmount();
    if (host.parentElement) host.parentElement.removeChild(host);
  };

  root.render(
    <NodeEditor
      anchor={options.anchor}
      initial={options.initial}
      onCommit={(next) => { dispose(); options.onCommit(next); }}
      onCancel={() => { dispose(); options.onCancel?.(); }}
    />,
  );

  return dispose;
}

// ── React 编辑器组件 ──

function NodeEditor({
  anchor,
  initial,
  onCommit,
  onCancel,
}: {
  anchor: HTMLElement;
  initial: Atom[];
  onCommit: (next: Atom[]) => void;
  onCancel: () => void;
}) {
  const popupRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [view, setView] = useState<EditorView | null>(null);
  const committedRef = useRef(false);

  // 初始化 EditorView
  useEffect(() => {
    if (!editorRef.current) return;
    const schema = getNodeContentSchema();
    const doc = schema.nodeFromJSON({ type: 'doc', content: initial });

    const markKeymap: Record<string, any> = {};
    if (schema.marks.bold) markKeymap['Mod-b'] = toggleMark(schema.marks.bold);
    if (schema.marks.italic) markKeymap['Mod-i'] = toggleMark(schema.marks.italic);
    if (schema.marks.underline) markKeymap['Mod-u'] = toggleMark(schema.marks.underline);
    if (schema.marks.strike) markKeymap['Mod-Shift-s'] = toggleMark(schema.marks.strike);
    if (schema.marks.code) markKeymap['Mod-e'] = toggleMark(schema.marks.code);
    if (schema.nodes.hardBreak) {
      markKeymap['Shift-Enter'] = (state: any, dispatch: any) => {
        if (dispatch) dispatch(state.tr.replaceSelectionWith(schema.nodes.hardBreak.create()));
        return true;
      };
    }

    // 提交 / 取消快捷键
    const submitKeymap: Record<string, any> = {
      'Mod-Enter': () => { commit(); return true; },
      'Escape': () => { cancel(); return true; },
    };

    const blockPlugins = blockRegistry.buildBlockPlugins();
    const nodeViews = blockRegistry.buildNodeViews();

    // 全套 plugin（参考 NoteEditor.buildPlugins，去掉 graph 不需要的）
    const plugins = [
      keymap(submitKeymap),                                   // 优先级最高
      columnResizing({ cellMinWidth: 80, View: null as any }),
      blockSelectionPlugin(),
      indentPlugin(),
      slashCommandPlugin(),
      linkClickPlugin(),
      containerKeyboardPlugin(),
      pasteMediaPlugin(),
      smartPastePlugin(),
      ...blockPlugins,
      buildInputRules(schema),
      keymap({ 'Mod-z': undo, 'Mod-Shift-z': redo, 'Mod-y': redo }),
      keymap(markKeymap),
      keymap(baseKeymap),
      blockHandlePlugin(),
      columnCollapsePlugin(),
      renderBlockFocusPlugin(),
      headingCollapsePlugin(),
      blockFramePlugin(),
      history(),
      dropCursor({ color: '#8ab4f8', width: 2 }),
      gapCursor(),
    ];

    const state = EditorState.create({ doc, plugins });
    const v = new EditorView(editorRef.current, {
      state,
      nodeViews: nodeViews as any,
      dispatchTransaction(tr) {
        if (v.isDestroyed) return;
        v.updateState(v.state.apply(tr));
      },
    });
    viewRef.current = v;
    setView(v);

    // focus 编辑器
    setTimeout(() => v.focus(), 0);

    return () => {
      if (!v.isDestroyed) v.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    const v = viewRef.current;
    if (!v) { onCancel(); return; }
    const json = v.state.doc.toJSON();
    const nextAtoms: Atom[] = (json?.content as Atom[] | undefined) ?? [];
    onCommit(nextAtoms);
  };

  const cancel = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCancel();
  };

  // 点击编辑器外部 → commit
  useEffect(() => {
    const onMouseDown = (ev: MouseEvent) => {
      if (committedRef.current) return;
      const target = ev.target as Node;
      if (popupRef.current?.contains(target)) return;
      // 也跳过 4 个 React UI 弹出的浮层（它们 portal 到 body）
      const tgtEl = ev.target as HTMLElement;
      if (tgtEl?.closest?.('[data-krig-editor-overlay]')) return;
      // 4 大 UI 自身用 fixed 浮层；它们的容器 dataset 标记由 NoteView 内部决定，
      // 这里用 className 兜底
      if (tgtEl?.closest?.('.slash-menu, .floating-toolbar, .handle-menu, .context-menu, .ask-ai-panel')) return;
      commit();
    };
    // 延迟挂载，避免 dblclick 那次 mousedown 误关闭
    const t = setTimeout(() => {
      window.addEventListener('mousedown', onMouseDown, true);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', onMouseDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 弹窗位置（fixed）
  const position = computePopupPosition(anchor);

  return (
    <div
      ref={popupRef}
      className="krig-graph-node-editor-popup note-editor"
      style={{
        position: 'fixed',
        left: position.left,
        ...(position.showAbove
          ? { bottom: position.bottom }
          : { top: position.top }),
        minWidth: 320,
        maxWidth: 520,
        minHeight: 80,
        maxHeight: 440,
        overflow: 'auto',
        background: '#1e1e1e',
        color: '#e0e0e0',
        border: '1px solid #4a90e2',
        borderRadius: 4,
        padding: '8px 10px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        zIndex: 2000,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <div ref={editorRef} />
      <SlashMenu view={view} />
      <FloatingToolbar view={view} />
      <HandleMenu view={view} />
      <ContextMenu view={view} />
    </div>
  );
}

function computePopupPosition(anchor: HTMLElement): {
  left: number;
  top: number;
  bottom: number;
  showAbove: boolean;
} {
  const rect = anchor.getBoundingClientRect();
  const margin = 6;
  const viewportH = window.innerHeight;
  const spaceBelow = viewportH - rect.bottom;
  const showAbove = spaceBelow < 200 && rect.top > 200;
  return {
    left: Math.max(8, rect.left - 20),
    top: rect.bottom + margin,
    bottom: viewportH - rect.top + margin,
    showAbove,
  };
}
