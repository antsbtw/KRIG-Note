import type { Atom } from '../../engines/GraphEngine';

/**
 * EditOverlay：节点 / 边的编辑浮层管理（v1.3 spec § 7）。
 *
 * 显示态 = 节点 SVG 几何 mesh；编辑态 = DOM PM 编辑器浮层覆盖在节点位置。
 *
 * 当前实现（Phase 3.1）：仅 textarea 占位，PM schema/UI 在 Phase 3.2-3.4 接入。
 *
 * DOM 结构：
 *   document.body
 *     └── backdrop (fixed inset:0, z-index:1000)
 *           └── popup (absolute, 绝对定位到屏幕坐标)
 *                 └── textarea
 *
 * 事件流：
 *   - 点 textarea / popup 内部 → 不冒泡到 backdrop（stopPropagation）
 *   - 点 backdrop 空白 → 触发 exit(true)
 *
 * 生命周期：
 *   enter(target) → mountPopup → focus
 *   exit(commit) → 提取 atoms → 销毁 popup
 */

export interface EditTarget {
  kind: 'node' | 'edge';
  id: string;
  atoms: Atom[];
  /** 浮层屏幕坐标（GraphEngine 已做世界 → 屏幕变换） */
  screenX: number;
  screenY: number;
}

export interface EditOverlayCallbacks {
  /** 编辑提交（commit=true）或取消（commit=false），返回新 atoms */
  onExit: (target: EditTarget, atoms: Atom[] | null) => void;
}

export class EditOverlay {
  private active: EditTarget | null = null;
  private textarea: HTMLTextAreaElement | null = null;
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
    const initialText = extractPlainText(target.atoms);

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
      // e.target === backdrop 才退出（popup 内的 mousedown 都 stopPropagation 了）
      if (e.target === backdrop) {
        this.exit(true);
      }
    });
    this.backdrop = backdrop;

    // popup：绝对定位到屏幕坐标
    const popup = document.createElement('div');
    popup.className = 'krig-edit-popup';
    popup.style.cssText = `
      position: absolute;
      left: ${target.screenX}px;
      top: ${target.screenY}px;
      width: 280px;
      padding: 8px;
      background: rgba(40, 44, 52, 0.95);
      border: 1px solid #4a90e2;
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
      transform: translate(-50%, -50%);
    `;
    // popup 内任何 mousedown 都不冒泡到 backdrop（保留对编辑器内部正常的 click/select 行为）
    popup.addEventListener('mousedown', (e) => e.stopPropagation());

    const textarea = document.createElement('textarea');
    textarea.value = initialText;
    textarea.style.cssText = `
      width: 100%;
      min-height: 60px;
      max-height: 200px;
      padding: 4px;
      background: transparent;
      color: #e0e0e0;
      border: none;
      outline: none;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      line-height: 1.4;
      resize: none;
      box-sizing: border-box;
    `;
    textarea.placeholder = 'Type label...';
    popup.appendChild(textarea);

    // 键盘事件
    textarea.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        this.exit(false);
        return;
      }
      // Enter 提交，Shift+Enter 换行；Cmd+Enter 也提交（多行场景）
      if (e.key === 'Enter') {
        if (e.shiftKey && !e.metaKey && !e.ctrlKey) return; // 换行
        e.preventDefault();
        this.exit(true);
      }
    });

    backdrop.appendChild(popup);
    document.body.appendChild(backdrop);

    this.textarea = textarea;

    // autofocus + 全选
    setTimeout(() => {
      textarea.focus();
      textarea.select();
    }, 50);
  }

  /** 关闭浮层。commit=true 时把当前 textarea 内容做成 atoms 回调；否则丢弃。 */
  exit(commit: boolean): void {
    if (!this.active) return;
    const target = this.active;

    let atoms: Atom[] | null = null;
    if (commit && this.textarea) {
      const text = this.textarea.value.trim();
      atoms = makeTextAtoms(text);
    }

    this.unmount();
    this.active = null;

    this.callbacks.onExit(target, atoms);
  }

  /** 销毁浮层资源 */
  private unmount(): void {
    if (this.backdrop) {
      this.backdrop.remove();
      this.backdrop = null;
    }
    this.textarea = null;
  }

  /** 外部 dispose（GraphEngine.dispose 时调） */
  dispose(): void {
    if (this.active) this.exit(false);
  }
}

// ── helpers ──

function extractPlainText(atoms: Atom[]): string {
  if (!atoms || !Array.isArray(atoms)) return '';
  const out: string[] = [];
  function walk(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    const n = node as { text?: string; content?: unknown[] };
    if (typeof n.text === 'string') out.push(n.text);
    if (Array.isArray(n.content)) n.content.forEach(walk);
  }
  atoms.forEach(walk);
  return out.join('');
}

/** 把纯文本包成单个 textBlock atom（Phase 3.1 占位；3.2 替换为 PM 输出） */
function makeTextAtoms(text: string): Atom[] {
  if (!text) return [{ type: 'textBlock', content: [] }];
  return [{ type: 'textBlock', content: [{ type: 'text', text }] }];
}
