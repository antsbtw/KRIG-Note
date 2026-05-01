/**
 * GraphEditor — 画板文字节点的 ProseMirror 编辑器实例(M2.1 §4.3)
 *
 * 职责:
 * - 用 NoteView 同源 schema(blockRegistry.buildSchema)创建 EditorView
 * - 装配画板裁剪版 plugin 清单(三层架构原则 5)
 * - 初始 atoms ↔ 提交 atoms 走 NoteView converter(三层架构原则 4)
 * - 销毁时清理 view + popovers
 *
 * 不持有:
 * - 浮窗位置 / backdrop / 显隐(EditOverlay 负责)
 * - 文字节点 mesh(NodeRenderer 负责)
 *
 * 与 NoteEditor 的关系:
 * - 共享 schema(blockRegistry 单例)
 * - 共享 NodeView(blockRegistry.buildNodeViews,KaTeX / image / table 等都能正常显示)
 * - 共享 converter(converterRegistry.atomsToDoc / docToAtoms)
 * - 不共享 React 组件壳(NoteEditor 绑 noteId / aiSync / thought / titleGuard 等)
 * - plugin 清单是 NoteEditor 的裁剪版(去掉 graph 不需要的)
 */

import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Schema } from 'prosemirror-model';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { history, undo, redo } from 'prosemirror-history';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { columnResizing } from 'prosemirror-tables';

// NoteView 共享件
import { blockRegistry } from '../../../note/registry';
import { registerAllBlocks } from '../../../note/blocks/index';
import { buildInputRules } from '../../../note/plugins/input-rules';
import { containerKeyboardPlugin } from '../../../note/plugins/container-keyboard';
import { slashCommandPlugin } from '../../../note/plugins/slash-command';
import { linkClickPlugin } from '../../../note/plugins/link-click';
import { blockSelectionPlugin } from '../../../note/plugins/block-selection';
import { indentPlugin } from '../../../note/plugins/indent';
import { pasteMediaPlugin } from '../../../note/plugins/paste-media';
import { smartPastePlugin } from '../../../note/paste/smart-paste-plugin';
import { renderBlockFocusPlugin } from '../../../note/plugins/render-block-focus';
import { headingCollapsePlugin } from '../../../note/plugins/heading-collapse';
import { blockFramePlugin } from '../../../note/plugins/block-frame';

import { textNodeAtomsToDocJson, pmDocToNoteAtoms } from './atom-bridge';
import type { Atom as NoteAtom } from '../../../../shared/types/atom-types';

let registryInitialized = false;

/** 一次性初始化:确保 blockRegistry 已注册全套 block + converter 表已填充 */
function ensureInitialized(): void {
  if (registryInitialized) return;
  registerAllBlocks();
  // 关键:把 converter 注册到 converterRegistry.byPMType / byAtomType
  // (没这步 docToAtoms 因 byPMType 空而返回空数组)
  blockRegistry.initConverters();
  registryInitialized = true;
}

/** 装配画板裁剪版 plugin(spec §4.4) */
function buildGraphCanvasPlugins(s: Schema) {
  const markKeymap: Record<string, unknown> = {};
  if (s.marks.bold) markKeymap['Mod-b'] = toggleMark(s.marks.bold);
  if (s.marks.italic) markKeymap['Mod-i'] = toggleMark(s.marks.italic);
  if (s.marks.underline) markKeymap['Mod-u'] = toggleMark(s.marks.underline);
  if (s.marks.strike) markKeymap['Mod-Shift-s'] = toggleMark(s.marks.strike);
  if (s.marks.code) markKeymap['Mod-e'] = toggleMark(s.marks.code);
  if (s.nodes.hardBreak) {
    markKeymap['Shift-Enter'] = (state: EditorState, dispatch: ((tr: unknown) => void) | undefined) => {
      if (dispatch) dispatch(state.tr.replaceSelectionWith(s.nodes.hardBreak.create()));
      return true;
    };
  }

  const blockPlugins = blockRegistry.buildBlockPlugins();

  return [
    // ── NoteView 复用 ──
    columnResizing({ cellMinWidth: 80, View: null as never }),
    blockSelectionPlugin(),
    indentPlugin(),
    slashCommandPlugin(),
    linkClickPlugin(),
    containerKeyboardPlugin(),
    pasteMediaPlugin(),
    smartPastePlugin(),
    ...blockPlugins,
    buildInputRules(s),
    keymap({ 'Mod-z': undo, 'Mod-Shift-z': redo, 'Mod-y': redo }),
    keymap(markKeymap as Parameters<typeof keymap>[0]),
    keymap(baseKeymap),
    renderBlockFocusPlugin(),
    headingCollapsePlugin(),
    blockFramePlugin(),
    history(),
    dropCursor({ color: '#8ab4f8', width: 2 }),
    gapCursor(),

    // ── 不接(对齐 spec §4.4)──
    // - blockHandlePlugin / HandleMenu(画板节点尺寸小,块手柄遮挡内容)
    // - columnCollapsePlugin(列布局画板暂不支持)
    // - thoughtPlugin / titleGuardPlugin(画板没 thought / noteTitle)
    // - vocabHighlightPlugin / fromPageDecorationPlugin(note 特定)
    // - InlineToolbar / SlashMenu UI 浮层 — 由 EditOverlay 自己挂载(M2.1.5)
  ];
}

export interface GraphEditorOptions {
  /** 初始内容,NoteView 同源 Atom[];可空 */
  initialAtoms?: unknown[];
}

export class GraphEditor {
  private view: EditorView | null = null;

  constructor(mount: HTMLElement, options: GraphEditorOptions = {}) {
    ensureInitialized();
    const schema = blockRegistry.buildSchema();
    const docJson = textNodeAtomsToDocJson(options.initialAtoms);
    const doc = schema.nodeFromJSON(docJson);

    const state = EditorState.create({
      schema,
      doc,
      plugins: buildGraphCanvasPlugins(schema),
    });

    this.view = new EditorView(mount, {
      state,
      attributes: {
        spellcheck: 'false',
        translate: 'no',
        class: 'krig-canvas-text-editor',
      },
      nodeViews: blockRegistry.buildNodeViews() as never,
      dispatchTransaction: (tr) => {
        const v = this.view;
        if (!v || v.isDestroyed) return;
        v.updateState(v.state.apply(tr));
      },
    });
  }

  /** PM doc → NoteView Atom[](commit 时用) */
  getAtoms(): NoteAtom[] {
    if (!this.view) return [];
    return pmDocToNoteAtoms(this.view.state.doc);
  }

  /** 获取 EditorView 给 UI 浮层(InlineToolbar / SlashMenu)使用 */
  getView(): EditorView | null {
    return this.view;
  }

  focus(): void {
    this.view?.focus();
  }

  destroy(): void {
    if (this.view && !this.view.isDestroyed) {
      this.view.destroy();
    }
    this.view = null;
  }
}
