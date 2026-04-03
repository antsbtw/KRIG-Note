/**
 * RenderBlock 基类 — 包裹型 Block 的统一骨架
 *
 * 提供：
 * - DOM 骨架：wrapper > toolbar + content
 * - Toolbar 注册：左侧 label + 右侧按钮组 + 中间可扩展
 * - 全屏能力：overlay + 缩放/平移
 * - stopEvent / ignoreMutation 统一处理
 *
 * Renderer 只需要：
 * - 填充 content 区域
 * - 注册 toolbar 按钮（可选）
 * - 提供全屏内容（可选）
 */

import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

/** Toolbar 按钮定义 */
export interface ToolbarButton {
  icon: string;          // 按钮 HTML（SVG 或 emoji）
  title: string;         // tooltip
  onClick: () => void;
  isActive?: () => boolean;  // 活跃状态（可选）
  className?: string;
}

/** Toolbar 按钮组 */
export interface ToolbarGroup {
  id: string;
  buttons: ToolbarButton[];
}

/** Renderer 实现接口 */
export interface RenderBlockRenderer {
  /** 创建内容区域 DOM，返回根元素 */
  createContent(
    node: PMNode,
    view: EditorView,
    getPos: () => number | undefined,
  ): HTMLElement;

  /** 节点更新时调用，返回 false 表示需要重建 */
  update?(node: PMNode, contentEl: HTMLElement): boolean;

  /** 注册 toolbar 按钮（可选） */
  toolbarButtons?(node: PMNode): ToolbarGroup[];

  /** 提供 label 文字（默认用 type 名） */
  label?(node: PMNode): string;

  /** 提供全屏内容（可选，返回 null 表示不支持全屏） */
  createFullscreenContent?(node: PMNode, contentEl: HTMLElement): HTMLElement | null;

  /** 提供 contentDOM（可选，如 image 的 caption）。返回的元素由 ProseMirror 管理内容 */
  getContentDOM?(contentEl: HTMLElement): HTMLElement | undefined;

  /** 自定义复制内容（可选，默认用 node.textContent） */
  getCopyText?(node: PMNode, contentEl: HTMLElement): string;

  /** 清理资源（可选） */
  destroy?(contentEl: HTMLElement): void;
}

/** 创建 RenderBlock 的 ProseMirror NodeView */
export function createRenderBlockView(
  renderer: RenderBlockRenderer,
  blockType: string,
) {
  return (node: PMNode, view: EditorView, getPos: () => number | undefined) => {
    // ── DOM 骨架 ──
    const dom = document.createElement('div');
    dom.classList.add('render-block', `render-block--${blockType}`);

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.classList.add('render-block__toolbar');
    toolbar.setAttribute('contenteditable', 'false');

    // Label（左侧）
    const labelEl = document.createElement('span');
    labelEl.classList.add('render-block__label');
    labelEl.textContent = renderer.label?.(node) ?? blockType;
    toolbar.appendChild(labelEl);

    // 中间弹性空间
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    toolbar.appendChild(spacer);

    // 按钮容器（右侧）
    const btnContainer = document.createElement('div');
    btnContainer.classList.add('render-block__btn-group');
    toolbar.appendChild(btnContainer);

    dom.appendChild(toolbar);

    // Content（Renderer 提供）
    const contentEl = renderer.createContent(node, view, getPos);
    contentEl.classList.add('render-block__content');
    dom.appendChild(contentEl);

    // ── Toolbar 按钮构建 ──
    let buttonElements: Map<string, HTMLButtonElement[]> = new Map();

    function buildToolbarButtons() {
      // 清空旧按钮
      btnContainer.innerHTML = '';
      buttonElements.clear();

      const groups = renderer.toolbarButtons?.(node) ?? [];

      // 全屏按钮（基类提供，如果 renderer 支持）
      if (renderer.createFullscreenContent) {
        groups.push({
          id: '_fullscreen',
          buttons: [{
            icon: '⛶',
            title: '全屏',
            onClick: () => openFullscreen(),
          }],
        });
      }

      // 复制按钮（基类提供）
      groups.push({
        id: '_copy',
        buttons: [{
          icon: '📋',
          title: '复制内容',
          onClick: () => copyContent(),
        }],
      });

      for (let gi = 0; gi < groups.length; gi++) {
        const group = groups[gi];
        if (gi > 0) {
          const sep = document.createElement('div');
          sep.classList.add('render-block__toolbar-sep');
          btnContainer.appendChild(sep);
        }

        const btns: HTMLButtonElement[] = [];
        for (const def of group.buttons) {
          const btn = document.createElement('button');
          btn.classList.add('render-block__toolbar-btn');
          if (def.className) btn.classList.add(def.className);
          btn.innerHTML = def.icon;
          btn.title = def.title;
          btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            def.onClick();
          });
          if (def.isActive?.()) btn.classList.add('render-block__toolbar-btn--active');
          btnContainer.appendChild(btn);
          btns.push(btn);
        }
        buttonElements.set(group.id, btns);
      }
    }

    buildToolbarButtons();

    // ── 复制 ──
    function copyContent() {
      const text = renderer.getCopyText?.(node, contentEl) ?? node.textContent ?? contentEl.textContent ?? '';
      navigator.clipboard.writeText(text).then(() => {
        // 视觉反馈
        const copyBtn = btnContainer.querySelector('[title="复制内容"]');
        if (copyBtn) {
          const original = copyBtn.innerHTML;
          copyBtn.innerHTML = '✓';
          (copyBtn as HTMLElement).style.color = '#4caf50';
          setTimeout(() => {
            copyBtn.innerHTML = original;
            (copyBtn as HTMLElement).style.color = '';
          }, 1500);
        }
      });
    }

    // ── 全屏 ──
    function openFullscreen() {
      const fullscreenContent = renderer.createFullscreenContent?.(node, contentEl);
      if (!fullscreenContent) return;

      const overlay = document.createElement('div');
      overlay.classList.add('render-block__fullscreen-overlay');

      const container = document.createElement('div');
      container.classList.add('render-block__fullscreen-container');

      const wrapper = document.createElement('div');
      wrapper.classList.add('render-block__fullscreen-wrapper');
      wrapper.appendChild(fullscreenContent);
      container.appendChild(wrapper);

      const closeBtn = document.createElement('button');
      closeBtn.classList.add('render-block__fullscreen-close');
      closeBtn.innerHTML = '&times;';
      closeBtn.title = 'Close (Esc)';

      overlay.appendChild(closeBtn);
      overlay.appendChild(container);
      document.body.appendChild(overlay);

      // 初始缩放适配屏幕
      requestAnimationFrame(() => {
        const contentRect = fullscreenContent.getBoundingClientRect();
        const vw = window.innerWidth * 0.9;
        const vh = window.innerHeight * 0.9;
        const fitScale = Math.min(
          vw / (contentRect.width || 800),
          vh / (contentRect.height || 600),
          3,
        );

        let scale = Math.max(fitScale, 0.3);
        let panX = 0, panY = 0;

        const applyTransform = () => {
          wrapper.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
        };
        applyTransform();

        // 滚轮缩放
        container.addEventListener('wheel', (ev) => {
          ev.preventDefault();
          const rect = container.getBoundingClientRect();
          const mx = ev.clientX - rect.left - rect.width / 2;
          const my = ev.clientY - rect.top - rect.height / 2;
          const factor = ev.deltaY < 0 ? 1.1 : 0.9;
          const newScale = Math.max(0.2, Math.min(5, scale * factor));
          panX = mx - (mx - panX) * (newScale / scale);
          panY = my - (my - panY) * (newScale / scale);
          scale = newScale;
          applyTransform();
        });

        // 拖拽平移
        let dragging = false;
        let startX = 0, startY = 0, startPanX = 0, startPanY = 0;

        container.addEventListener('mousedown', (ev) => {
          if ((ev.target as HTMLElement).tagName === 'BUTTON') return;
          dragging = true;
          startX = ev.clientX;
          startY = ev.clientY;
          startPanX = panX;
          startPanY = panY;
          container.style.cursor = 'grabbing';
        });

        window.addEventListener('mousemove', function onMove(ev) {
          if (!dragging) return;
          panX = startPanX + (ev.clientX - startX);
          panY = startPanY + (ev.clientY - startY);
          applyTransform();
        });

        window.addEventListener('mouseup', function onUp() {
          dragging = false;
          container.style.cursor = 'grab';
        });
      });

      // 关闭
      const close = () => {
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
      };
      closeBtn.addEventListener('click', close);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
      const escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', escHandler);
    }

    // ── contentDOM（有 ProseMirror 管理的子内容时使用） ──
    const pmContentDOM = renderer.getContentDOM?.(contentEl);

    // ── NodeView 接口 ──
    return {
      dom,

      contentDOM: pmContentDOM,

      stopEvent(event: Event) {
        // 如果有 contentDOM，只拦截 toolbar 和非 contentDOM 区域的事件
        if (pmContentDOM && pmContentDOM.contains(event.target as Node)) return false;
        if (dom.contains(event.target as Node)) return true;
        return false;
      },

      update(updatedNode: PMNode) {
        if (updatedNode.type.name !== blockType) return false;
        node = updatedNode;

        // 更新 label
        labelEl.textContent = renderer.label?.(updatedNode) ?? blockType;

        // 更新 toolbar 按钮（活跃状态等）
        buildToolbarButtons();

        // 通知 renderer 更新
        if (renderer.update) {
          return renderer.update(updatedNode, contentEl);
        }
        return true;
      },

      ignoreMutation() {
        return true;
      },

      destroy() {
        renderer.destroy?.(contentEl);
      },
    };
  };
}
