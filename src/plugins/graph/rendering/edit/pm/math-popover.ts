/**
 * MathPopover：mathInline / mathBlock 的 LaTeX 输入 + 实时 KaTeX 预览。
 *
 * 浮在 math NodeView 旁边。Esc 取消、Enter / 失焦提交。
 *
 * 单例：全局只允许一个 popover，再 open 时关闭旧的。
 */
import katex from 'katex';
import 'katex/dist/katex.min.css';

let activePopover: MathPopover | null = null;

interface MathPopoverOptions {
  /** 锚点 DOM（NodeView 的 root），用于定位 */
  anchor: HTMLElement;
  /** 初始 tex 字符串 */
  initialTex: string;
  /** display 模式（mathBlock = true，mathInline = false） */
  display: boolean;
  /** 提交时调用，传新 tex；commit=false 表示取消（不写回） */
  onClose: (tex: string | null) => void;
}

class MathPopover {
  private root: HTMLDivElement;
  private input: HTMLTextAreaElement;
  private preview: HTMLDivElement;
  private hint: HTMLDivElement;
  private closed = false;

  constructor(private opts: MathPopoverOptions) {
    const root = document.createElement('div');
    root.className = 'krig-math-popover';
    root.style.cssText = `
      position: fixed;
      z-index: 1200;
      width: 280px;
      padding: 8px;
      background: rgba(30, 33, 39, 0.98);
      border: 1px solid #4a90e2;
      border-radius: 6px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.55);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      color: #e0e0e0;
    `;
    root.addEventListener('mousedown', (e) => e.stopPropagation());
    this.root = root;

    const input = document.createElement('textarea');
    input.value = opts.initialTex;
    input.placeholder = opts.display ? 'LaTeX (display)\\sum_i x_i' : 'LaTeX e.g. E = mc^2';
    input.style.cssText = `
      width: 100%;
      min-height: 50px;
      max-height: 120px;
      padding: 4px 6px;
      background: rgba(0,0,0,0.3);
      color: #e0e0e0;
      border: 1px solid #444;
      border-radius: 3px;
      outline: none;
      font-family: 'JetBrains Mono', Menlo, monospace;
      font-size: 12px;
      line-height: 1.5;
      resize: vertical;
      box-sizing: border-box;
    `;
    input.addEventListener('input', () => this.updatePreview());
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // 避免冒泡到 popup keydown
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close(false);
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !opts.display)) {
        // mathInline: 单 Enter 提交；mathBlock: Cmd-Enter 提交（block 内允许换行）
        e.preventDefault();
        this.close(true);
      }
    });
    root.appendChild(input);
    this.input = input;

    const preview = document.createElement('div');
    preview.className = 'krig-math-popover-preview';
    preview.style.cssText = `
      margin-top: 8px;
      padding: 6px 8px;
      background: rgba(0,0,0,0.2);
      border-radius: 3px;
      min-height: 28px;
      color: #dddddd;
      font-size: 14px;
      overflow-x: auto;
    `;
    root.appendChild(preview);
    this.preview = preview;

    const hint = document.createElement('div');
    hint.style.cssText = `
      margin-top: 6px;
      font-size: 10px;
      color: #777;
    `;
    hint.textContent = opts.display
      ? 'Cmd+Enter 提交 / Esc 取消'
      : 'Enter 提交 / Esc 取消';
    root.appendChild(hint);
    this.hint = hint;

    document.body.appendChild(root);
    this.position();
    this.updatePreview();

    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);
  }

  /** 定位到 anchor 下方 */
  private position(): void {
    const rect = this.opts.anchor.getBoundingClientRect();
    this.root.style.left = `${rect.left}px`;
    this.root.style.top = `${rect.bottom + 4}px`;
  }

  private updatePreview(): void {
    const tex = this.input.value;
    if (!tex.trim()) {
      this.preview.innerHTML = '<span style="opacity:0.5;font-size:11px;">(空公式)</span>';
      return;
    }
    try {
      this.preview.innerHTML = katex.renderToString(tex, {
        displayMode: this.opts.display,
        throwOnError: false,
        errorColor: '#f55',
      });
    } catch (e) {
      this.preview.innerHTML = `<span style="color:#f55;font-size:11px;">parse error</span>`;
      void e;
    }
  }

  close(commit: boolean): void {
    if (this.closed) return;
    this.closed = true;
    const tex = commit ? this.input.value.trim() : null;
    this.root.remove();
    if (activePopover === this) activePopover = null;
    this.opts.onClose(tex);
  }
}

/** 打开 math popover（全局单例） */
export function openMathPopover(opts: MathPopoverOptions): void {
  if (activePopover) activePopover.close(false);
  activePopover = new MathPopover(opts);
}

/** 是否有 math popover 激活（编辑器 Esc 抢占判断用） */
export function isMathPopoverOpen(): boolean {
  return activePopover !== null;
}

/** 关闭当前 popover */
export function closeMathPopover(commit: boolean): void {
  if (activePopover) activePopover.close(commit);
}
