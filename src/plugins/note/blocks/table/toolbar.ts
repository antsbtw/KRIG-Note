/**
 * table/toolbar.ts — 单元格选区浮动工具条
 *
 * 何时显示：
 *   (a) CellSelection 多格选中      → 合并 / 复制
 *   (b) 光标在已合并 cell（colspan>1 或 rowspan>1） → 拆分
 *
 * 位置：贴在选区/cell 上方，固定定位。点击 editor 其它地方或失去焦点时消失。
 * 走 Plugin + view 回调，不走 React；和 NodeView 一层的其它 DOM 保持风格一致。
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { CellSelection, mergeCells, splitCell } from 'prosemirror-tables';
import type { CellAlign } from '../table';
import { duplicateSelectedCells, setCellAlign } from './commands';

const key = new PluginKey('tableToolbar');

interface ToolbarItem {
  label: string;
  icon?: string;
  title?: string;       // hover tooltip
  danger?: boolean;
  active?: boolean;     // 选中态
  run: (view: EditorView) => void;
}

/** 构造 4 档对齐 + 清除 的工具条按钮列表 */
function alignItems(currentAlign: CellAlign | null): ToolbarItem[] {
  const make = (value: CellAlign | null, icon: string, title: string): ToolbarItem => ({
    label: '',
    icon,
    title,
    active: currentAlign === value,
    run: (v) => { setCellAlign(value)(v.state, v.dispatch); v.focus(); },
  });
  return [
    make('left',    '⇤', '左对齐'),
    make('center',  '↔', '居中'),
    make('right',   '⇥', '右对齐'),
    make('justify', '☰', '两端对齐'),
    make(null,      '∅', '清除对齐'),
  ];
}

/** 计算选区/当前 cell 的代表 align（如果所有 cell align 一致则返回该值，否则返回 null） */
function getSelectionAlign(view: EditorView): CellAlign | null {
  const sel = view.state.selection;
  const aligns = new Set<CellAlign | null>();
  if (sel instanceof CellSelection) {
    sel.forEachCell((cell) => { aligns.add((cell.attrs.align ?? null) as CellAlign | null); });
  } else {
    const $from = sel.$from;
    for (let d = $from.depth; d > 0; d--) {
      const n = $from.node(d);
      if (n.type.name === 'tableCell' || n.type.name === 'tableHeader') {
        aligns.add((n.attrs.align ?? null) as CellAlign | null);
        break;
      }
    }
  }
  return aligns.size === 1 ? (aligns.values().next().value as CellAlign | null) : null;
}

function getToolbarTarget(view: EditorView): {
  items: ToolbarItem[];
  anchorRect: DOMRect;
} | null {
  const { state } = view;
  const sel = state.selection;

  const curAlign = getSelectionAlign(view);

  // (a) CellSelection 多格
  if (sel instanceof CellSelection) {
    const { $anchorCell, $headCell } = sel;
    if ($anchorCell.pos === $headCell.pos) {
      // 单格 CellSelection —— 不显示（避免每次点击都弹）
      return null;
    }
    // 取选区第一个 cell 的 DOM
    const anchorDOM = view.nodeDOM($anchorCell.pos) as HTMLElement | null;
    if (!anchorDOM) return null;
    return {
      anchorRect: anchorDOM.getBoundingClientRect(),
      items: [
        { label: '合并单元格', icon: '⊞', run: (v) => { mergeCells(v.state, v.dispatch); v.focus(); } },
        { label: '复制选区',   icon: '⧉', run: (v) => { duplicateSelectedCells(v.state, v.dispatch); v.focus(); } },
        ...alignItems(curAlign),
      ],
    };
  }

  // (b) 普通光标在已合并 cell 内
  const $from = state.selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === 'tableCell' || n.type.name === 'tableHeader') {
      const { colspan = 1, rowspan = 1 } = n.attrs as { colspan?: number; rowspan?: number };
      if (colspan > 1 || rowspan > 1) {
        const cellPos = $from.before(d);
        const dom = view.nodeDOM(cellPos) as HTMLElement | null;
        if (!dom) return null;
        return {
          anchorRect: dom.getBoundingClientRect(),
          items: [
            { label: '拆分单元格', icon: '⊟', run: (v) => { splitCell(v.state, v.dispatch); v.focus(); } },
            ...alignItems(curAlign),
          ],
        };
      }
      break;
    }
  }

  return null;
}

export function tableToolbarPlugin(): Plugin {
  return new Plugin({
    key,
    view(editorView) {
      let toolbar: HTMLElement | null = null;

      const destroy = () => {
        if (toolbar && toolbar.parentNode) toolbar.parentNode.removeChild(toolbar);
        toolbar = null;
      };

      const render = (view: EditorView) => {
        const target = getToolbarTarget(view);
        if (!target) {
          destroy();
          return;
        }

        if (!toolbar) {
          toolbar = document.createElement('div');
          toolbar.className = 'table-block__toolbar';
          toolbar.setAttribute('contenteditable', 'false');
          toolbar.addEventListener('mousedown', (e) => e.preventDefault());
          document.body.appendChild(toolbar);
        }

        toolbar.innerHTML = '';
        for (const item of target.items) {
          const btn = document.createElement('button');
          const classes = ['table-block__toolbar-btn'];
          if (item.danger) classes.push('is-danger');
          if (item.active) classes.push('is-active');
          btn.className = classes.join(' ');
          btn.setAttribute('contenteditable', 'false');
          if (item.title) btn.title = item.title;
          if (item.icon) {
            const ic = document.createElement('span');
            ic.className = 'table-block__toolbar-icon';
            ic.textContent = item.icon;
            btn.appendChild(ic);
          }
          if (item.label) {
            const lbl = document.createElement('span');
            lbl.textContent = item.label;
            btn.appendChild(lbl);
          }
          btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            item.run(view);
          });
          toolbar.appendChild(btn);
        }

        // 位置：cell 顶部偏上
        const tbRect = toolbar.getBoundingClientRect();
        const top = Math.max(8, target.anchorRect.top - tbRect.height - 6);
        const left = Math.min(
          Math.max(8, target.anchorRect.left),
          window.innerWidth - tbRect.width - 8,
        );
        toolbar.style.top = `${top}px`;
        toolbar.style.left = `${left}px`;
      };

      render(editorView);

      return {
        update(view) {
          render(view);
        },
        destroy,
      };
    },
  });
}
