/**
 * RenderBlock 基类 — 统一骨架
 *
 * 提供：
 * - DOM 骨架：wrapper > toolbar + content
 * - Toolbar：左侧 label + 右侧按钮组
 * - selectNode / deselectNode 选中视觉反馈
 * - stopEvent / ignoreMutation 统一处理
 * - destroy 生命周期清理
 * - 通用 placeholder 模式（Upload + Embed link 双按钮）
 *
 * 适用于：image、audio 等简单 RenderBlock。
 * video、tweet 有自己的 tab bar，不使用此基类，直接导出 NodeView 工厂。
 */

import type { EditorView } from 'prosemirror-view';
import { NodeSelection } from 'prosemirror-state';
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

/** Placeholder 配置（Upload + Embed link 双按钮模式） */
export interface PlaceholderConfig {
  icon: string;
  uploadLabel?: string;
  uploadAccept?: string;
  embedLabel?: string;
  embedPlaceholder?: string;
  onUpload?: (dataUrl: string, file: File) => void;
  onEmbed?: (url: string) => void;
}

/** Renderer 实现接口 */
export interface RenderBlockRenderer {
  createContent(node: PMNode, view: EditorView, getPos: () => number | undefined): HTMLElement;
  update?(node: PMNode, contentEl: HTMLElement): boolean;
  toolbarButtons?(node: PMNode, contentEl?: HTMLElement): ToolbarGroup[];
  label?(node: PMNode): string;
  getContentDOM?(contentEl: HTMLElement): HTMLElement | undefined;
  getCopyText?(node: PMNode, contentEl: HTMLElement): string;
  destroy?(contentEl: HTMLElement): void;
}

// ── Placeholder 构建工具 ──

export function createPlaceholder(config: PlaceholderConfig): HTMLElement {
  const placeholder = document.createElement('div');
  placeholder.classList.add('render-block__placeholder');

  const iconEl = document.createElement('span');
  iconEl.classList.add('render-block__placeholder-icon');
  iconEl.textContent = config.icon;
  placeholder.appendChild(iconEl);

  const btnRow = document.createElement('div');
  btnRow.classList.add('render-block__placeholder-actions');

  if (config.onUpload && config.uploadLabel) {
    const uploadBtn = document.createElement('button');
    uploadBtn.classList.add('render-block__placeholder-btn');
    uploadBtn.textContent = config.uploadLabel;
    uploadBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = config.uploadAccept || '*/*';
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => config.onUpload!(reader.result as string, file);
        reader.readAsDataURL(file);
      });
      input.click();
    });
    btnRow.appendChild(uploadBtn);
  }

  if (config.onEmbed && config.embedLabel) {
    const embedBtn = document.createElement('button');
    embedBtn.classList.add('render-block__placeholder-btn');
    embedBtn.textContent = config.embedLabel;

    const inputWrapper = document.createElement('div');
    inputWrapper.classList.add('render-block__placeholder-input');
    inputWrapper.style.display = 'none';

    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.placeholder = config.embedPlaceholder || 'https://...';

    const submitBtn = document.createElement('button');
    submitBtn.classList.add('render-block__placeholder-submit');
    submitBtn.textContent = 'Embed';

    const submit = () => {
      const url = urlInput.value.trim();
      if (url) config.onEmbed!(url);
    };

    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { inputWrapper.style.display = 'none'; btnRow.style.display = 'flex'; }
    });
    submitBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); submit(); });

    embedBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      btnRow.style.display = 'none';
      inputWrapper.style.display = 'flex';
      setTimeout(() => urlInput.focus(), 0);
    });

    inputWrapper.appendChild(urlInput);
    inputWrapper.appendChild(submitBtn);

    btnRow.appendChild(embedBtn);
    placeholder.appendChild(btnRow);
    placeholder.appendChild(inputWrapper);
  } else {
    placeholder.appendChild(btnRow);
  }

  return placeholder;
}

// ── NodeView 工厂（简单 RenderBlock 用） ──

export function createRenderBlockView(
  renderer: RenderBlockRenderer,
  blockType: string,
) {
  return (node: PMNode, view: EditorView, getPos: () => number | undefined) => {
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
      const groups = renderer.toolbarButtons?.(node, contentEl) ?? [];

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

    // ── contentDOM ──
    const pmContentDOM = renderer.getContentDOM?.(contentEl);

    // ── 点击非 caption 区域 → NodeSelection ──
    // 清除 DOM selection 是为了消除 caption contenteditable 内残留的 caret——
    // 否则用户视觉上会以为光标还在 caption 里，粘贴时却把整个 block 替换掉。
    contentEl.addEventListener('mousedown', (e) => {
      if (pmContentDOM && pmContentDOM.contains(e.target as Node)) return;
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos == null) return;
      window.getSelection()?.removeAllRanges();
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
      view.focus();
    });

    // ── NodeView 接口 ──
    return {
      dom,
      contentDOM: pmContentDOM,

      selectNode() { dom.classList.add('render-block--selected'); },
      deselectNode() { dom.classList.remove('render-block--selected'); },

      stopEvent(event: Event) {
        if (event.type === 'contextmenu') return false;
        // 放行 mousemove/mouseleave 让 block-handle 能探测到此 block
        if (event.type === 'mousemove' || event.type === 'mouseleave') return false;
        if (pmContentDOM && pmContentDOM.contains(event.target as Node)) return false;
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
        if (pmContentDOM && pmContentDOM.contains(mutation.target)) return false;
        return true;
      },

      destroy() { renderer.destroy?.(contentEl); },
    };
  };
}
