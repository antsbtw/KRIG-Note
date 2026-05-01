/**
 * EditOverlay — 文字节点编辑浮层管理器(M2.1 §4.2)
 *
 * 形态:fixed backdrop + 圆角胶囊 popup,popup 内挂 GraphEditor.
 *
 * DOM 结构:
 *   document.body
 *     └── backdrop (fixed inset:0, z:1000, transparent)
 *           └── popup (fixed, 屏幕坐标定位,深灰圆角胶囊)
 *                 └── pm-mount (PM EditorView 挂载点)
 *
 * 事件流:
 *   - 点 popup 内部:mousedown stopPropagation,不冒泡到 backdrop
 *   - 点 backdrop 空白:exit(commit=true)
 *   - Esc:exit(commit=false)(若内部有 popover 激活则让位给浮层关闭)
 *   - Cmd/Ctrl+Enter:exit(commit=true)
 *   - popup 级 keydown 阻止冒泡(防 GraphView 全局 Backspace/Delete 删节点 / Cmd+Z 画板 undo)
 */

import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import type { Atom as NoteAtom } from '../../../../shared/types/atom-types';
import { GraphEditor } from './GraphEditor';
import { InlineToolbar } from './InlineToolbar';
import { SlashMenu } from '../../../note/components/SlashMenu';
// note.css 提供 NoteView 全套 block 渲染样式(h1/h2/h3/ul/ol/code/table 等)
// 画板编辑态复用 NoteView schema + NodeView,样式来源也必须复用,否则 popup 内
// 渲染出来的 block 会回退到浏览器默认样式,与 NoteView 视觉割裂
import '../../../note/note.css';
import './edit-overlay.css';

export interface EditTarget {
  /** 关联的 instance id */
  id: string;
  /** 初始 atoms(NoteView 同源) */
  atoms: NoteAtom[];
  /** popup 左上角屏幕坐标(对齐节点 mesh 的左上角) */
  screenX: number;
  screenY: number;
  /** popup 宽高(屏幕像素;对齐节点 mesh 实际投影尺寸,让编辑态与展示态视觉重合) */
  width: number;
  height: number;
  /** Sticky 背景色(M2.2);CSS 颜色字符串;不传 = 透明(默认 Text 节点) */
  backgroundColor?: string;
}

export interface EditOverlayCallbacks {
  /** 编辑结束;commit=true 写回 atoms,false 丢弃 */
  onExit: (target: EditTarget, atoms: NoteAtom[] | null) => void;
}

export class EditOverlay {
  private active: EditTarget | null = null;
  private editor: GraphEditor | null = null;
  private backdrop: HTMLDivElement | null = null;
  /** UI 浮层 React root(InlineToolbar + SlashMenu)— 挂在 popup 外的独立宿主 */
  private uiRoot: Root | null = null;
  private uiHost: HTMLDivElement | null = null;

  constructor(private callbacks: EditOverlayCallbacks) {}

  isActive(): boolean {
    return this.active !== null;
  }

  getActiveTarget(): EditTarget | null {
    return this.active;
  }

  /** 打开浮层;已激活时先 commit 当前的再开新的 */
  enter(target: EditTarget): void {
    if (this.active) this.exit(true);
    this.active = target;

    // backdrop 全屏:点空白处 commit + exit
    const backdrop = document.createElement('div');
    backdrop.className = 'krig-canvas-edit-backdrop';
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) this.exit(true);
    });
    this.backdrop = backdrop;

    // popup:fixed,左上角对齐节点 mesh 屏幕投影,宽高完全重合(原地编辑)
    const popup = document.createElement('div');
    popup.className = 'krig-canvas-edit-popup';
    popup.style.left = `${target.screenX}px`;
    popup.style.top = `${target.screenY}px`;
    popup.style.width = `${target.width}px`;
    popup.style.minHeight = `${target.height}px`;
    // Sticky:popup 背景色与 mesh 背景一致,编辑态与展示态视觉无缝过渡.
    // 走 CSS var 而不是直接 backgroundColor,避免 .krig-canvas-edit-popup
    // 类样式特异性反超 inline(尤其是有 !important 时);文字色也跟着切到深色,
    // 黄底上深字才能读.
    if (target.backgroundColor) {
      popup.style.setProperty('--popup-bg', target.backgroundColor);
      popup.style.setProperty('--popup-fg', '#222');
    }
    popup.addEventListener('mousedown', (e) => e.stopPropagation());

    // PM 挂载点
    const pmMount = document.createElement('div');
    pmMount.className = 'krig-canvas-edit-pm-mount';
    popup.appendChild(pmMount);

    backdrop.appendChild(popup);
    document.body.appendChild(backdrop);

    // 创建 GraphEditor
    this.editor = new GraphEditor(pmMount, { initialAtoms: target.atoms });

    // UI 浮层(InlineToolbar / SlashMenu)挂在 body 独立宿主里(避免 popup 边界裁剪;
    // SlashMenu 用 fixed 定位,不依赖父元素 overflow)
    const uiHost = document.createElement('div');
    uiHost.className = 'krig-canvas-edit-ui';
    document.body.appendChild(uiHost);
    this.uiHost = uiHost;
    this.uiRoot = createRoot(uiHost);
    const view = this.editor.getView();
    this.uiRoot.render(
      createElement(
        'div',
        null,
        createElement(InlineToolbar, { view, key: 'toolbar' }),
        createElement(SlashMenu, { view, key: 'slash' }),
      ),
    );

    // popup 级 keydown:capture 阶段拦截 Esc / Cmd+Enter(优先于 PM keymap)
    popup.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        // M2.1.5 加 hasOpenPopover() 判断后,这里需要让位给内部浮层
        e.preventDefault();
        e.stopPropagation();
        this.exit(false);
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        this.exit(true);
      }
    }, { capture: true });

    // popup 级 keydown:bubble 阶段阻止冒泡到 window
    // 防止 GraphView 全局快捷键(Backspace/Delete 删节点 / Cmd+Z 画板 undo)
    popup.addEventListener('keydown', (e) => {
      e.stopPropagation();
    });

    // autofocus(setTimeout 给浏览器一帧让 DOM 就位)
    setTimeout(() => this.editor?.focus(), 0);
  }

  /** 关闭浮层;commit=true 时把 atoms 回调 */
  exit(commit: boolean): void {
    if (!this.active) return;
    const target = this.active;
    let atoms: NoteAtom[] | null = null;
    if (commit && this.editor) atoms = this.editor.getAtoms();

    this.unmount();
    this.active = null;
    this.callbacks.onExit(target, atoms);
  }

  private unmount(): void {
    if (this.uiRoot) {
      this.uiRoot.unmount();
      this.uiRoot = null;
    }
    if (this.uiHost) {
      this.uiHost.remove();
      this.uiHost = null;
    }
    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
    }
    if (this.backdrop) {
      this.backdrop.remove();
      this.backdrop = null;
    }
  }

  /** 销毁(canvas unmount 时调) */
  dispose(): void {
    if (this.active) this.exit(false);
  }
}
