/**
 * Inline Toolbar：选中文字时在选区上方浮一条小工具栏（B / I / U / code）。
 *
 * 触发：selection 非空且不在 atom 节点内（不在 mathInline / mathBlock 内）。
 * 关闭：selection 变空 / 焦点离开编辑器。
 *
 * 点击按钮 → toggleMark dispatch transaction → mark 切换。
 */
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { toggleMark } from 'prosemirror-commands';
import type { MarkType } from 'prosemirror-model';
import { graphSchema } from './schema';

export const inlineToolbarKey = new PluginKey('graphInlineToolbar');

interface ToolbarItem {
  id: string;
  label: string;
  title: string;
  markType: MarkType;
}

function buildItems(): ToolbarItem[] {
  const m = graphSchema.marks;
  return [
    { id: 'bold', label: 'B', title: 'Bold (⌘B)', markType: m.bold },
    { id: 'italic', label: 'I', title: 'Italic (⌘I)', markType: m.italic },
    { id: 'underline', label: 'U', title: 'Underline (⌘U)', markType: m.underline },
    { id: 'code', label: '<>', title: 'Code (⌘E)', markType: m.code },
  ];
}

/** mark 是否在当前 selection 范围内激活（用于按钮高亮态） */
function markActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

interface ToolbarOptions {
  mount?: HTMLElement;
}

export function buildInlineToolbarPlugin(options: ToolbarOptions = {}): Plugin {
  const items = buildItems();
  const mountEl = options.mount ?? document.body;

  return new Plugin({
    key: inlineToolbarKey,

    view(view) {
      const toolbarEl = document.createElement('div');
      toolbarEl.className = 'krig-inline-toolbar';
      toolbarEl.style.display = 'none';
      mountEl.appendChild(toolbarEl);
      // mousedown 不影响 PM 选区（避免点按钮丢选区）
      toolbarEl.addEventListener('mousedown', (e) => e.preventDefault());

      // 渲染按钮
      const buttons = items.map((item) => {
        const btn = document.createElement('button');
        btn.className = 'krig-inline-toolbar-btn';
        btn.dataset.id = item.id;
        btn.title = item.title;
        btn.textContent = item.label;
        btn.addEventListener('mousedown', (e) => e.preventDefault());
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const cmd = toggleMark(item.markType);
          cmd(view.state, view.dispatch);
          view.focus();
        });
        toolbarEl.appendChild(btn);
        return btn;
      });

      function update(currentView: EditorView): void {
        const state = currentView.state;
        const { from, to, empty } = state.selection;

        // 选区为空 → 隐藏
        if (empty) {
          toolbarEl.style.display = 'none';
          return;
        }

        // 选区在 atom 节点（math 等）→ 隐藏
        const $from = state.doc.resolve(from);
        if ($from.parent.type.spec.atom) {
          toolbarEl.style.display = 'none';
          return;
        }

        // 编辑器失焦 → 隐藏
        if (!currentView.hasFocus() && !toolbarEl.contains(document.activeElement)) {
          toolbarEl.style.display = 'none';
          return;
        }

        // 更新按钮激活态
        items.forEach((item, i) => {
          const active = markActive(state, item.markType);
          buttons[i].classList.toggle('is-active', active);
        });

        // 定位：选区起点上方
        const startCoords = currentView.coordsAtPos(from);
        const endCoords = currentView.coordsAtPos(to);
        const centerX = (startCoords.left + endCoords.right) / 2;
        toolbarEl.style.display = 'flex';
        toolbarEl.style.position = 'fixed';
        toolbarEl.style.left = `${centerX}px`;
        toolbarEl.style.top = `${startCoords.top - 6}px`;
        // transform 在 CSS 里设：translate(-50%, -100%)
        toolbarEl.style.zIndex = '1100';
      }

      // 初次渲染
      update(view);

      return {
        update(currentView, _prevState) {
          update(currentView);
        },
        destroy() {
          toolbarEl.remove();
        },
      };
    },
  });
}
