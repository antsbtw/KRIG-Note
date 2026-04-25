import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history, undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { blockRegistry } from '../../note/registry';
import { getNodeContentSchema } from '../engines/NodeContentRenderer';
import type { Atom } from '../engines/GraphEngine';

/**
 * NodeEditorPopup — 节点 / 边的 ProseMirror 编辑器浮窗
 *
 * spec v1.2 § 7.2：双击 label → 弹出独立编辑器，复用 NoteView 的 schema +
 * blockRegistry.buildBlockPlugins()（核心 Block 行为如 codeBlock Tab / math
 * 输入等），用户可写 mathBlock / codeBlock / bulletList 等任意 Block 类型。
 *
 * 不复用：
 * - NoteEditor 组件（绑定 noteId，含 thoughtPlugin / titleGuard / aiSync 等
 *   GraphView 不需要的能力）
 * - 复杂插件如 SlashMenu / vocabHighlight / blockHandle 等（GraphView 节点
 *   编辑场景下用不上，先保持简洁；用户有需求时再单独评估）
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
 * 打开节点/边编辑器弹窗。返回 dispose 函数（一般无需主动调，提交/取消会自动清理）。
 */
export function openNodeEditor(options: OpenEditorOptions): () => void {
  const { anchor, initial, onCommit, onCancel } = options;
  const schema = getNodeContentSchema();

  // 容器 div：fixed 定位在 anchor 旁边
  const popup = document.createElement('div');
  popup.className = 'krig-graph-node-editor-popup';
  applyPopupStyle(popup, anchor);

  // ProseMirror 内部 doc
  const doc = schema.nodeFromJSON({ type: 'doc', content: initial });

  let committed = false;
  let view: EditorView | null = null;

  const cleanup = () => {
    window.removeEventListener('mousedown', onOutsideMouseDown, true);
    if (view) {
      view.destroy();
      view = null;
    }
    if (popup.parentElement) popup.parentElement.removeChild(popup);
  };

  const commit = () => {
    if (committed || !view) return;
    committed = true;
    const json = view.state.doc.toJSON();
    const nextAtoms: Atom[] = (json?.content as Atom[] | undefined) ?? [];
    cleanup();
    onCommit(nextAtoms);
  };

  const cancel = () => {
    if (committed) return;
    committed = true;
    cleanup();
    onCancel?.();
  };

  // 点击编辑器外部 → commit
  const onOutsideMouseDown = (ev: MouseEvent) => {
    if (popup.contains(ev.target as Node)) return;
    commit();
  };

  // ── 构建插件列表（精简） ──
  const markKeymap: Record<string, any> = {};
  if (schema.marks.bold) markKeymap['Mod-b'] = toggleMark(schema.marks.bold);
  if (schema.marks.italic) markKeymap['Mod-i'] = toggleMark(schema.marks.italic);
  if (schema.marks.underline) markKeymap['Mod-u'] = toggleMark(schema.marks.underline);
  if (schema.marks.strike) markKeymap['Mod-Shift-s'] = toggleMark(schema.marks.strike);
  if (schema.marks.code) markKeymap['Mod-e'] = toggleMark(schema.marks.code);

  // hardBreak 兼容
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

  // 复用 NoteView 的核心 Block plugins（codeBlock Tab、math 输入等）
  const blockPlugins = blockRegistry.buildBlockPlugins();
  const nodeViews = blockRegistry.buildNodeViews();

  const plugins = [
    keymap(submitKeymap),                                    // 优先级最高：提交/取消
    keymap({ 'Mod-z': undo, 'Mod-Shift-z': redo, 'Mod-y': redo }),
    keymap(markKeymap),
    ...blockPlugins,
    keymap(baseKeymap),
    history(),
    dropCursor({ color: '#8ab4f8', width: 2 }),
    gapCursor(),
  ];

  const state = EditorState.create({ doc, plugins });
  view = new EditorView(popup, {
    state,
    nodeViews: nodeViews as any,
    dispatchTransaction(tr) {
      if (!view || view.isDestroyed) return;
      view.updateState(view.state.apply(tr));
    },
  });

  document.body.appendChild(popup);
  view.focus();

  // 延迟挂载 outside listener，避免 dblclick 那次 mousedown 误关闭
  setTimeout(() => {
    if (!committed) window.addEventListener('mousedown', onOutsideMouseDown, true);
  }, 0);

  return cleanup;
}

// ── 弹窗样式 ──

function applyPopupStyle(popup: HTMLDivElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();

  // 默认显示在 anchor 下方；如果下方空间不够则在上方
  const popupMaxHeight = 400;
  const margin = 6;
  const viewportH = window.innerHeight;
  const spaceBelow = viewportH - rect.bottom;
  const showAbove = spaceBelow < 200 && rect.top > 200;

  popup.style.cssText = `
    position: fixed;
    left: ${Math.max(8, rect.left - 20)}px;
    ${showAbove ? `bottom: ${viewportH - rect.top + margin}px;` : `top: ${rect.bottom + margin}px;`}
    min-width: 280px;
    max-width: 480px;
    min-height: 60px;
    max-height: ${popupMaxHeight}px;
    overflow-y: auto;
    background: #1e1e1e;
    color: #e0e0e0;
    border: 1px solid #4a90e2;
    border-radius: 4px;
    padding: 8px 10px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    z-index: 2000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 13px;
    line-height: 1.5;
  `;
}
