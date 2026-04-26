import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Atom } from '../../../engines/GraphEngine';
import { graphSchema } from './schema';
import { buildGraphPmPlugins } from './plugins';
import { pmDocToAtoms, atomsToPmDoc } from './atom-bridge';
import { slashMenuKey } from './slash-menu';

/**
 * GraphEditor：薄包装 PM EditorView。
 *
 * 职责：
 * - 创建 EditorView 挂在 mount 元素内
 * - 用 atoms 初始化 doc
 * - 暴露 getAtoms() / focus() / destroy()
 *
 * 不处理：
 * - 浮层定位 / 退出（EditOverlay 负责）
 * - slash menu / inline toolbar（Phase 3.4）
 * - mathInline / mathBlock 的 NodeView 渲染（Phase 3.4）
 */
export class GraphEditor {
  private view: EditorView | null = null;

  constructor(mount: HTMLElement, initialAtoms: Atom[]) {
    const state = EditorState.create({
      schema: graphSchema,
      doc: atomsToPmDoc(initialAtoms),
      plugins: buildGraphPmPlugins(),
    });

    this.view = new EditorView(mount, {
      state,
      // 默认 contentEditable + spellcheck 关闭（节点 label 通常不需要拼写检查）
      attributes: {
        spellcheck: 'false',
        translate: 'no',
      },
    });
  }

  /** 把当前 doc 转回 Atom[]（commit 时用） */
  getAtoms(): Atom[] {
    if (!this.view) return [];
    return pmDocToAtoms(this.view.state.doc);
  }

  /** 当前是否有内嵌浮窗（slash menu / math popover）激活 */
  hasOpenPopover(): boolean {
    if (!this.view) return false;
    const slashState = slashMenuKey.getState(this.view.state);
    return !!slashState?.active;
  }

  focus(): void {
    this.view?.focus();
  }

  destroy(): void {
    this.view?.destroy();
    this.view = null;
  }
}
