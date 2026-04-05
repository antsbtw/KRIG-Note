/**
 * RenderBlock 基类 — 统一骨架
 *
 * 提供：
 * - DOM 骨架：wrapper > toolbar + content
 * - Toolbar：左侧 label + 右侧按钮组
 * - stopEvent / ignoreMutation 统一处理
 *
 * Renderer 只需提供：
 * - 内容区域 DOM
 * - toolbar 按钮（可选）
 * - label 文字（可选）
 */

import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

/** Toolbar 按钮定义 */
export interface ToolbarButton {
  icon: string;
  title: string;
  onClick: () => void;
  isActive?: () => boolean;
  className?: string;
}

/** Toolbar 按钮组 */
export interface ToolbarGroup {
  id: string;
  buttons: ToolbarButton[];
}

/** Renderer 实现接口 */
export interface RenderBlockRenderer {
  createContent(node: PMNode, view: EditorView, getPos: () => number | undefined): HTMLElement;
  update?(node: PMNode, contentEl: HTMLElement): boolean;
  toolbarButtons?(node: PMNode): ToolbarGroup[];
  label?(node: PMNode): string;
  getContentDOM?(contentEl: HTMLElement): HTMLElement | undefined;
  getCopyText?(node: PMNode, contentEl: HTMLElement): string;
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

    const labelEl = document.createElement('span');
    labelEl.classList.add('render-block__label');
    labelEl.textContent = renderer.label?.(node) ?? blockType;
    toolbar.appendChild(labelEl);

    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    toolbar.appendChild(spacer);

    const btnContainer = document.createElement('div');
    btnContainer.classList.add('render-block__btn-group');
    toolbar.appendChild(btnContainer);

    dom.appendChild(toolbar);

    // Content
    const contentEl = renderer.createContent(node, view, getPos);
    contentEl.classList.add('render-block__content');
    dom.appendChild(contentEl);

    // ── Toolbar 按钮构建 ──
    function buildToolbarButtons() {
      btnContainer.innerHTML = '';
      const groups = renderer.toolbarButtons?.(node) ?? [];

      // 复制按钮（基类提供）
      groups.push({
        id: '_copy',
        buttons: [{
          icon: '📋',
          title: '复制内容',
          onClick: () => {
            const text = renderer.getCopyText
              ? renderer.getCopyText(node, contentEl)
              : node.textContent;
            navigator.clipboard.writeText(text).catch(() => {});
          },
        }],
      });

      for (let gi = 0; gi < groups.length; gi++) {
        const group = groups[gi];
        if (gi > 0) {
          const sep = document.createElement('div');
          sep.classList.add('render-block__toolbar-sep');
          btnContainer.appendChild(sep);
        }
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
        }
      }
    }

    buildToolbarButtons();

    // ── contentDOM（有 ProseMirror 管理的子内容时使用） ──
    const pmContentDOM = renderer.getContentDOM?.(contentEl);

    // ── NodeView 接口 ──
    return {
      dom,
      contentDOM: pmContentDOM,

      stopEvent(event: Event) {
        // 右键菜单不拦截
        if (event.type === 'contextmenu') return false;
        // contentDOM 内的事件不拦截
        if (pmContentDOM && pmContentDOM.contains(event.target as Node)) return false;
        // 其余拦截
        if (dom.contains(event.target as Node)) return true;
        return false;
      },

      update(updatedNode: PMNode) {
        if (updatedNode.type.name !== blockType) return false;
        node = updatedNode;
        labelEl.textContent = renderer.label?.(updatedNode) ?? blockType;
        buildToolbarButtons();
        if (renderer.update) return renderer.update(updatedNode, contentEl);
        return true;
      },

      ignoreMutation(mutation: MutationRecord) {
        // contentDOM 内的变化必须交给 ProseMirror 处理
        if (pmContentDOM && pmContentDOM.contains(mutation.target)) return false;
        return true;
      },

      destroy() { renderer.destroy?.(contentEl); },
    };
  };
}
