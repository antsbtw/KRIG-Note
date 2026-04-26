import type { Atom } from '../../engines/GraphEngine';
import { GraphEditor } from './pm/editor';
import './edit-overlay.css';

/**
 * EditOverlay：节点 / 边的编辑浮层管理（v1.3 spec § 7）。
 *
 * 显示态 = 节点 SVG 几何 mesh；编辑态 = DOM PM 编辑器浮层覆盖在节点位置。
 *
 * Phase 3.2：textarea 替换为 ProseMirror EditorView（GraphEditor）。
 *
 * DOM 结构：
 *   document.body
 *     └── backdrop (fixed inset:0, z-index:1000)
 *           └── popup (absolute, 屏幕坐标定位)
 *                 └── pm-mount (PM EditorView 挂载点)
 *
 * 事件流：
 *   - 点 popup 内部 → mousedown stopPropagation，不冒泡到 backdrop
 *   - 点 backdrop 空白 → 触发 exit(true)
 *
 * 键盘:
 *   - Esc: 取消（不写回）
 *   - Cmd-Enter / Ctrl-Enter: 提交
 *   - 其他键 PM 自己处理（含 Mod-B/I/U/E、Tab/Shift-Tab、Shift-Enter 等）
 */

export interface EditTarget {
  kind: 'node' | 'edge';
  id: string;
  atoms: Atom[];
  /** 锚点屏幕坐标（节点圆心 / 边 label 中心） */
  screenX: number;
  screenY: number;
  /**
   * 浮卡相对锚点的 Y 偏移（用于避开节点圆）。
   * 浮卡顶部 = screenY + anchorOffsetY。默认 0（顶部对齐锚点）。
   */
  anchorOffsetY?: number;
}

export interface EditOverlayCallbacks {
  /** 编辑提交（commit=true）或取消（commit=false），返回新 atoms */
  onExit: (target: EditTarget, atoms: Atom[] | null) => void;
}

export class EditOverlay {
  private active: EditTarget | null = null;
  private editor: GraphEditor | null = null;
  private backdrop: HTMLDivElement | null = null;

  constructor(private callbacks: EditOverlayCallbacks) {}

  isActive(): boolean {
    return this.active !== null;
  }

  getActiveTarget(): EditTarget | null {
    return this.active;
  }

  /** 打开编辑浮层。已激活时先 commit 当前的，再开新的。 */
  enter(target: EditTarget): void {
    if (this.active) this.exit(true);

    this.active = target;

    // 全屏 backdrop：点击 backdrop 提交并退出
    const backdrop = document.createElement('div');
    backdrop.className = 'krig-edit-backdrop';
    backdrop.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 1000;
      background: transparent;
      pointer-events: auto;
    `;
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) {
        this.exit(true);
      }
    });
    this.backdrop = backdrop;

    // popup：绝对定位到屏幕坐标
    // 节点编辑时 anchorOffsetY > 0 → 浮卡放节点下方；不设时仍居中（边 label 等）
    const offsetY = target.anchorOffsetY ?? 0;
    const popup = document.createElement('div');
    popup.className = 'krig-edit-popup';
    if (offsetY > 0) popup.classList.add('krig-edit-popup--below');
    popup.style.cssText = `
      position: absolute;
      left: ${target.screenX}px;
      top: ${target.screenY + offsetY}px;
      width: 300px;
      padding: 8px 10px;
      background: rgba(40, 44, 52, 0.97);
      border: 1px solid #4a90e2;
      border-radius: 8px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.55);
      ${offsetY > 0 ? 'transform: translate(-50%, 0);' : 'transform: translate(-50%, -50%);'}
      color: #e0e0e0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      line-height: 1.5;
    `;
    popup.addEventListener('mousedown', (e) => e.stopPropagation());

    // PM 挂载点
    const pmMount = document.createElement('div');
    pmMount.className = 'krig-edit-pm-mount';
    pmMount.style.cssText = `
      min-height: 24px;
      max-height: 240px;
      overflow-y: auto;
      outline: none;
    `;
    popup.appendChild(pmMount);

    backdrop.appendChild(popup);
    document.body.appendChild(backdrop);

    // 创建 PM 编辑器
    this.editor = new GraphEditor(pmMount, target.atoms);

    // popup 级 keydown - capture 阶段：拦截 Esc / Cmd+Enter（先于 PM keymap）
    popup.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          this.exit(false);
        } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          this.exit(true);
        }
      },
      { capture: true },
    );

    // popup 级 keydown - bubble 阶段：阻止所有按键冒泡到 window，避免
    // GraphView 全局快捷键（Backspace/Delete deleteSelected, Cmd+Z undo）
    // 误操作图谱。PM 已经在 popup 之内处理过，此处只是阻止外溢。
    popup.addEventListener('keydown', (e) => {
      e.stopPropagation();
    });

    // autofocus
    setTimeout(() => {
      this.editor?.focus();
    }, 50);
  }

  /** 关闭浮层。commit=true 时把 PM doc 转回 atoms 回调；否则丢弃。 */
  exit(commit: boolean): void {
    if (!this.active) return;
    const target = this.active;

    let atoms: Atom[] | null = null;
    if (commit && this.editor) {
      atoms = this.editor.getAtoms();
    }

    this.unmount();
    this.active = null;

    this.callbacks.onExit(target, atoms);
  }

  private unmount(): void {
    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
    }
    if (this.backdrop) {
      this.backdrop.remove();
      this.backdrop = null;
    }
  }

  dispose(): void {
    if (this.active) this.exit(false);
  }
}
