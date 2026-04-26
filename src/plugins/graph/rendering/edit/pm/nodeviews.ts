/**
 * mathInline / mathBlock 的 PM NodeView。
 *
 * 显示态：KaTeX 渲染的 SVG/HTML。
 * 双击 / Click：打开 MathPopover 编辑 tex。
 * tex 改变后 dispatch transaction 更新节点 attrs。
 */
import katex from 'katex';
import 'katex/dist/katex.min.css';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import { openMathPopover } from './math-popover';

abstract class MathNodeViewBase implements NodeView {
  dom: HTMLElement;
  protected abstract display: boolean;

  constructor(
    protected node: PMNode,
    protected view: EditorView,
    protected getPos: () => number | undefined,
  ) {
    this.dom = this.createDom();
    this.render();
    this.dom.addEventListener('click', this.handleClick);
  }

  protected abstract createDom(): HTMLElement;

  private render(): void {
    const tex = (this.node.attrs.tex as string) ?? '';
    if (!tex.trim()) {
      this.dom.innerHTML = `<span class="krig-math-empty">+ ${this.display ? 'math' : 'inline'}</span>`;
      return;
    }
    try {
      this.dom.innerHTML = katex.renderToString(tex, {
        displayMode: this.display,
        throwOnError: false,
        errorColor: '#f55',
      });
    } catch (e) {
      this.dom.innerHTML = `<span style="color:#f55">err: ${escapeHtml(tex)}</span>`;
      void e;
    }
  }

  private handleClick = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    this.openEditor();
  };

  protected openEditor(): void {
    const initialTex = (this.node.attrs.tex as string) ?? '';
    openMathPopover({
      anchor: this.dom,
      initialTex,
      display: this.display,
      onClose: (tex) => {
        if (tex === null) {
          // 取消编辑：如果是新插入的空 atom，删掉
          if (!initialTex && !tex) this.deleteNode();
          this.view.focus();
          return;
        }
        if (!tex.trim()) {
          // 提交空：删除节点
          this.deleteNode();
          return;
        }
        this.updateTex(tex);
      },
    });
  }

  private updateTex(tex: string): void {
    const pos = this.getPos();
    if (pos === undefined) return;
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...this.node.attrs,
      tex,
    });
    this.view.dispatch(tr);
    this.view.focus();
  }

  private deleteNode(): void {
    const pos = this.getPos();
    if (pos === undefined) return;
    const tr = this.view.state.tr.delete(pos, pos + this.node.nodeSize);
    this.view.dispatch(tr);
    this.view.focus();
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('is-selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('is-selected');
  }

  destroy(): void {
    this.dom.removeEventListener('click', this.handleClick);
  }

  // PM 不要尝试改我的 DOM 内容（NodeView 自己管 render）
  ignoreMutation(): boolean {
    return true;
  }

  stopEvent(_e: Event): boolean {
    // mousedown 等让我们 click handler 自己处理
    return false;
  }
}

export class MathInlineNodeView extends MathNodeViewBase {
  protected display = false;

  protected createDom(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'krig-math-inline';
    span.contentEditable = 'false';
    return span;
  }
}

export class MathBlockNodeView extends MathNodeViewBase {
  protected display = true;

  protected createDom(): HTMLElement {
    const div = document.createElement('div');
    div.className = 'krig-math-block';
    div.contentEditable = 'false';
    return div;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return c;
    }
  });
}
