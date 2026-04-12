// @ts-ignore — Vite ?raw import
import syncInjectRaw from './sync-inject.js?raw';
import { SYNC_ACTION, WEB_TRANSLATE_PROTOCOL } from './sync-protocol';

const SYNC_POLL_MS = 80;

/**
 * SyncDriver — renderer 侧的同步引擎
 *
 * 控制权模型（见 slot-communication.md）：
 * - 同一时刻只有单向通信：controller 发，passive 收
 * - 控制权由用户活动自动触发：poll 到事件 → takeControl → 对面 yield
 * - 初始状态两侧都是 passive，第一次用户交互触发切换
 */
export class SyncDriver {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private webviewEl: Electron.WebviewTag | null = null;
  private active = false;
  private clickSyncLock = false;
  private polling = false;

  /** 当前角色：controller（发送方）或 passive（接收方） */
  role: 'controller' | 'passive' = 'passive';

  constructor(
    private side: 'left' | 'right',
    private sendToOther: (message: { protocol: string; action: string; payload: unknown }) => void,
    private onInputEnter?: (value: string, selector: string) => Promise<string | null>,
    /** 外部 guard：返回 true 时跳过 poll（如翻译注入中） */
    private isBusy?: () => boolean,
  ) {}

  /** 绑定 webview 元素 */
  bind(webview: Electron.WebviewTag): void {
    this.webviewEl = webview;
  }

  /** 抢占控制权：本侧变 controller，通知对面变 passive */
  takeControl(): void {
    if (this.role === 'controller') return; // 已经是 controller
    this.role = 'controller';
    console.log(`[SyncDriver:${this.side}] → CONTROLLER`);
    // 通知对面变为 passive
    this.sendToOther({
      protocol: WEB_TRANSLATE_PROTOCOL,
      action: SYNC_ACTION.TAKE_CONTROL,
      payload: { fromSide: this.side },
    });
  }

  /** 被对面抢占控制权：本侧变 passive */
  yield(): void {
    if (this.role === 'passive') return;
    this.role = 'passive';
    console.log(`[SyncDriver:${this.side}] → PASSIVE`);
    // 清空自己 guest 的事件队列（防止切回 controller 时发送旧事件）
    this.drainQueue();
  }

  /** 页面加载完成后注入同步脚本并开始轮询 */
  start(): void {
    if (!this.webviewEl) return;
    this.injectSyncScript();
    this.active = true;
    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => this.poll(), SYNC_POLL_MS);
    }
  }

  /** 页面导航后重新注入 */
  reinject(): void {
    this.injectSyncScript();
  }

  stop(): void {
    this.active = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  destroy(): void {
    this.stop();
    this.webviewEl = null;
  }

  // ── 接收对面发来的同步事件（仅 passive 时生效） ──

  handleRemoteEvents(events: SyncEvent[], fromSide: 'left' | 'right'): void {
    if (!this.webviewEl || !this.active) return;
    // 只有 passive 才接收事件（controller 不接收对面的事件）
    if (this.role === 'controller') return;
    if (this.webviewEl.isLoading()) return;
    if (this.isBusy?.()) return;

    const direction = `${fromSide}-to-${this.side}` as 'left-to-right' | 'right-to-left';

    let totalDeltaY = 0;
    let lastAnchor: ScrollAnchorEvent | null = null;
    const otherEvents: SyncEvent[] = [];

    for (const ev of events) {
      if (ev.type === 'scroll-delta') totalDeltaY += (ev as ScrollDeltaEvent).deltaY;
      else if (ev.type === 'scroll-anchor') lastAnchor = ev as ScrollAnchorEvent;
      else otherEvents.push(ev);
    }

    if (totalDeltaY !== 0) this.applyScrollDelta(totalDeltaY);
    if (lastAnchor) this.applyScrollAnchor(lastAnchor);

    for (const ev of otherEvents) {
      switch (ev.type) {
        case 'click':
          this.applyClickSync(ev as ClickEvent);
          break;
        case 'input':
          if (direction === 'left-to-right') {
            this.applyInputSync(ev as InputSyncEvent);
          }
          break;
        case 'input-enter':
          if (direction === 'right-to-left') {
            this.handleInputEnter(ev as InputEnterEvent);
          }
          break;
        case 'submit':
          this.applySubmitSync(ev as SubmitEvent);
          break;
        case 'selection':
          this.applySelectionHighlight(ev as SelectionEvent);
          break;
      }
    }
  }

  private async handleInputEnter(event: InputEnterEvent): Promise<void> {
    if (!this.onInputEnter || !this.webviewEl) return;

    const translated = await this.onInputEnter(event.value, event.selector);
    const finalValue = translated || event.value;

    this.webviewEl.executeJavaScript(`
      (function() {
        window.__mirroInputLock = true;
        try {
          var el = document.querySelector(${JSON.stringify(event.selector)});
          if (!el) return;
          el.value = ${JSON.stringify(finalValue)};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          var form = el.closest('form');
          if (form) {
            if (form.requestSubmit) form.requestSubmit();
            else form.submit();
          }
        } catch(e) {}
        setTimeout(function() { window.__mirroInputLock = false; }, 200);
      })();
    `).catch(() => {});
  }

  // ── Private ──

  private injectSyncScript(): void {
    if (!this.webviewEl) return;
    const script = (syncInjectRaw as string).replace('__MIRRO_SIDE__', this.side);
    this.webviewEl.executeJavaScript(script).catch(() => {});
  }

  /** 清空 guest 的事件队列（passive 时丢弃） */
  private drainQueue(): void {
    if (!this.webviewEl || this.webviewEl.isLoading()) return;
    this.webviewEl.executeJavaScript(`window.__mirroSyncQueue = [];`).catch(() => {});
  }

  private poll(): void {
    if (!this.webviewEl || !this.active) return;
    if (this.polling) return;
    if (this.webviewEl.isLoading()) return;
    if (this.isBusy?.()) return;

    this.polling = true;

    // fire-and-forget 模式：不 await，用 .then 处理结果
    this.webviewEl.executeJavaScript(`
      (function() {
        var q = window.__mirroSyncQueue || [];
        window.__mirroSyncQueue = [];
        return q.length > 0 ? q : null;
      })();
    `).then((events) => {
      this.polling = false;
      if (!events || events.length === 0) return;

      // 有用户事件 → 自动抢占控制权
      if (this.role !== 'controller') {
        this.role = 'controller';
        this.sendToOther({
          protocol: WEB_TRANSLATE_PROTOCOL,
          action: SYNC_ACTION.TAKE_CONTROL,
          payload: { fromSide: this.side },
        });
      }

      this.sendToOther({
        protocol: WEB_TRANSLATE_PROTOCOL,
        action: SYNC_ACTION.SYNC_EVENTS,
        payload: { events, fromSide: this.side },
      });
    }).catch(() => {
      this.polling = false;
    });
  }

  // ── Apply methods ──

  private applyScrollDelta(deltaY: number): void {
    this.webviewEl?.executeJavaScript(`
      (function() {
        var targetY = Math.round(window.scrollY + ${deltaY});
        window.__mirroProgramScrollY = targetY;
        window.scrollBy(0, ${deltaY});
      })();
    `).catch(() => {});
  }

  private applyScrollAnchor(event: ScrollAnchorEvent): void {
    if (event.anchor) {
      const anchorJSON = JSON.stringify(event.anchor);
      this.webviewEl?.executeJavaScript(`
        (function() {
          try {
            var anchor = ${anchorJSON};
            var els = document.getElementsByTagName(anchor.tag);
            var el = els[anchor.index];
            if (el) {
              var rect = el.getBoundingClientRect();
              var targetY = window.scrollY + rect.top + (anchor.offsetRatio * rect.height);
              window.__mirroSmoothScrolling = true;
              window.scrollTo({ top: targetY, behavior: 'smooth' });
              setTimeout(function() { window.__mirroSmoothScrolling = false; }, 400);
            }
          } catch(e) {}
        })();
      `).catch(() => {});
    } else if (event.pctY !== undefined) {
      this.webviewEl?.executeJavaScript(`
        (function() {
          var maxY = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
          window.__mirroSmoothScrolling = true;
          window.scrollTo({ top: ${event.pctY} * maxY, behavior: 'smooth' });
          setTimeout(function() { window.__mirroSmoothScrolling = false; }, 400);
        })();
      `).catch(() => {});
    }
  }

  private applyClickSync(event: ClickEvent): void {
    if (this.clickSyncLock) return;
    this.clickSyncLock = true;

    const toggleStateJSON = JSON.stringify(event.toggleState || null);
    this.webviewEl?.executeJavaScript(`
      (function() {
        window.__mirroClickLock = true;
        try {
          var el = document.querySelector(${JSON.stringify(event.selector)});
          if (!el) return;
          var toggleState = ${toggleStateJSON};
          var shouldClick = true;
          if (toggleState) {
            if (toggleState.attr === 'aria-expanded' && toggleState.value !== null) {
              var toggle = el.closest ? (el.closest('[aria-expanded]') || el) : el;
              var current = toggle.getAttribute('aria-expanded');
              if (current === toggleState.value) shouldClick = false;
            } else if (toggleState.controlledSelector && toggleState.visible !== undefined) {
              var controlled = document.querySelector(toggleState.controlledSelector);
              if (controlled) {
                var style = window.getComputedStyle(controlled);
                var isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
                if (isVisible === toggleState.visible) shouldClick = false;
              }
            }
          }
          if (shouldClick) el.click();
        } catch(e) {}
        setTimeout(function() { window.__mirroClickLock = false; }, 100);
      })();
    `).catch(() => {});

    setTimeout(() => { this.clickSyncLock = false; }, 100);
  }

  private applyInputSync(event: InputSyncEvent): void {
    this.webviewEl?.executeJavaScript(`
      (function() {
        window.__mirroInputLock = true;
        try {
          var el = document.querySelector(${JSON.stringify(event.selector)});
          if (!el) return;
          var tag = el.tagName.toLowerCase();
          if (tag === 'input' || tag === 'textarea') {
            if (el.type === 'checkbox' || el.type === 'radio') {
              el.checked = ${event.checked};
            } else {
              el.value = ${JSON.stringify(event.value)};
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (tag === 'select') {
            el.value = ${JSON.stringify(event.value)};
            el.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (el.isContentEditable) {
            el.textContent = ${JSON.stringify(event.value)};
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        } catch(e) {}
        setTimeout(function() { window.__mirroInputLock = false; }, 50);
      })();
    `).catch(() => {});
  }

  private applySubmitSync(event: SubmitEvent): void {
    this.webviewEl?.executeJavaScript(`
      (function() {
        window.__mirroInputLock = true;
        try {
          var form = document.querySelector(${JSON.stringify(event.selector)});
          if (!form) return;
          var formData = ${JSON.stringify(event.formData)};
          for (var name in formData) {
            var input = form.querySelector('[name="' + name + '"], #' + name);
            if (!input) continue;
            if (input.type === 'checkbox' || input.type === 'radio') {
              input.checked = formData[name].checked;
            } else {
              input.value = formData[name].value;
            }
          }
          form.submit();
        } catch(e) {}
        setTimeout(function() { window.__mirroInputLock = false; }, 200);
      })();
    `).catch(() => {});
  }

  private applySelectionHighlight(event: SelectionEvent): void {
    const blocksJSON = JSON.stringify(event.blocks);
    this.webviewEl?.executeJavaScript(`
      (function() {
        if (!document.getElementById('__mirroHighlightStyle')) {
          var style = document.createElement('style');
          style.id = '__mirroHighlightStyle';
          style.textContent = '.__mirro-highlight { background-color: rgba(138,180,248,0.15) !important; outline: 2px solid rgba(138,180,248,0.5) !important; outline-offset: 2px !important; border-radius: 4px !important; }';
          document.head.appendChild(style);
        }
        var old = document.querySelectorAll('.__mirro-highlight');
        for (var i = 0; i < old.length; i++) old[i].classList.remove('__mirro-highlight');
        var blocks = ${blocksJSON};
        if (!blocks) return;
        for (var j = 0; j < blocks.length; j++) {
          try {
            var els = document.getElementsByTagName(blocks[j].tag);
            var el = els[blocks[j].index];
            if (el) el.classList.add('__mirro-highlight');
          } catch(e) {}
        }
      })();
    `).catch(() => {});
  }
}

// ── Event types ──

interface ScrollDeltaEvent { type: 'scroll-delta'; deltaY: number }
interface ScrollAnchorEvent { type: 'scroll-anchor'; anchor: { tag: string; index: number; offsetRatio: number } | null; pctX?: number; pctY?: number }
interface ClickEvent { type: 'click'; selector: string; toggleState?: { attr?: string; value?: string; controlledSelector?: string; visible?: boolean } | null }
interface InputSyncEvent { type: 'input'; selector: string; value: string; inputType: string; checked: boolean }
interface SubmitEvent { type: 'submit'; selector: string; formData: Record<string, { value: string; checked: boolean }> }
interface SelectionEvent { type: 'selection'; blocks: Array<{ tag: string; index: number }> | null }
interface InputEnterEvent { type: 'input-enter'; selector: string; value: string }
type SyncEvent = ScrollDeltaEvent | ScrollAnchorEvent | ClickEvent | InputSyncEvent | SubmitEvent | SelectionEvent | InputEnterEvent | { type: string; [key: string]: unknown };
