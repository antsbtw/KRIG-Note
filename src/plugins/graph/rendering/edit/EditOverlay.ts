import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { Atom } from '../../engines/GraphEngine';

/**
 * EditOverlay：节点 / 边的编辑浮层管理（v1.3 spec § 7）。
 *
 * 显示态 = 节点 SVG 几何 mesh；编辑态 = DOM PM 编辑器浮层覆盖在节点位置。
 * 浮层用 CSS2DObject 锚定到 3D 场景中的目标位置（节点圆心），随相机变换平移。
 *
 * 当前实现（Phase 3.1）：仅 textarea 占位，PM schema/UI 在 Phase 3.2-3.4 接入。
 *
 * 生命周期：
 *   enter(target) → mountPopup → focus
 *   exit(commit) → 提取 atoms → 销毁 popup
 *
 * 调用方（GraphEngine）负责：
 *   - 隐藏目标节点 content visibility
 *   - 提交时调 setNodeLabel(id, atoms) → 触发 redraw
 */

export interface EditTarget {
  kind: 'node' | 'edge';
  id: string;
  atoms: Atom[];
  /** 浮层挂载的位置（世界坐标）：节点为节点中心，边为 label 中心 */
  worldPos: THREE.Vector3;
}

export interface EditOverlayCallbacks {
  /** 编辑提交（commit=true）或取消（commit=false），返回新 atoms */
  onExit: (target: EditTarget, atoms: Atom[] | null) => void;
}

export class EditOverlay {
  private active: EditTarget | null = null;
  private cssObj: CSS2DObject | null = null;
  private textarea: HTMLTextAreaElement | null = null;

  constructor(
    private scene: THREE.Scene,
    private callbacks: EditOverlayCallbacks,
  ) {}

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

    const root = document.createElement('div');
    root.className = 'krig-edit-popup';
    root.style.cssText = `
      width: 280px;
      padding: 8px;
      background: rgba(40, 44, 52, 0.95);
      border: 1px solid #4a90e2;
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
      pointer-events: auto;
      transform: translate(-50%, -50%);
    `;

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
    `;
    textarea.placeholder = 'Type label...';
    root.appendChild(textarea);

    // 事件
    textarea.addEventListener('blur', () => {
      // 延迟一帧避免 click 立即触发 blur 后再操作 dom
      setTimeout(() => this.exit(true), 0);
    });
    textarea.addEventListener('keydown', (e) => {
      e.stopPropagation(); // 防止 GraphView 全局快捷键
      if (e.key === 'Escape') {
        e.preventDefault();
        this.exit(false);
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        this.exit(true);
      }
    });

    this.textarea = textarea;
    this.cssObj = new CSS2DObject(root);
    this.cssObj.position.copy(target.worldPos);
    this.scene.add(this.cssObj);

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
    if (this.cssObj) {
      this.cssObj.parent?.remove(this.cssObj);
      this.cssObj.element.remove();
      this.cssObj = null;
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
