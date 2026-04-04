/**
 * Group Decoration Plugin — 视觉容器渲染
 *
 * 扫描文档中所有带 groupType 的 textBlock，推导组内位置，
 * 用 Decoration 添加 CSS class + 列表符号 widget。
 *
 * groupType 支持：
 *   bullet  → • / ◦ / ▪ 列表符号
 *   ordered → 1. / 2. / 3. 自动编号
 *   task    → ☐ / ☑ checkbox
 *   callout → 背景 + 边框 + emoji（首行）
 *   quote   → 左侧竖线
 *   toggle  → 首行折叠箭头 + 子内容显隐
 *   frame   → 彩色左边框
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

export const groupDecorationKey = new PluginKey('groupDecoration');

type GroupPosition = 'first' | 'middle' | 'last' | 'only';

/** 推导 Block 在组内的位置 */
function getGroupPosition(
  doc: PMNode,
  index: number,
  blockInfos: BlockInfo[],
): GroupPosition {
  const curr = blockInfos[index];
  if (!curr.groupType) return 'only';

  const prev = index > 0 ? blockInfos[index - 1] : null;
  const next = index < blockInfos.length - 1 ? blockInfos[index + 1] : null;

  const sameAsPrev = prev?.groupType === curr.groupType;
  const sameAsNext = next?.groupType === curr.groupType;

  if (!sameAsPrev && !sameAsNext) return 'only';
  if (!sameAsPrev) return 'first';
  if (!sameAsNext) return 'last';
  return 'middle';
}

interface BlockInfo {
  pos: number;
  size: number;
  groupType: string | null;
  groupAttrs: Record<string, unknown> | null;
  indent: number;
  level: number | null;
}

/** 扫描文档，收集所有 Block 信息 */
function scanBlocks(doc: PMNode): BlockInfo[] {
  const infos: BlockInfo[] = [];
  doc.forEach((node, pos) => {
    if (node.type.name === 'textBlock') {
      infos.push({
        pos,
        size: node.nodeSize,
        groupType: node.attrs.groupType || null,
        groupAttrs: node.attrs.groupAttrs || null,
        indent: node.attrs.indent || 0,
        level: node.attrs.level || null,
      });
    } else {
      // RenderBlock 等非 textBlock 也收集（用于断开组）
      infos.push({
        pos,
        size: node.nodeSize,
        groupType: null,
        groupAttrs: null,
        indent: 0,
        level: null,
      });
    }
  });
  return infos;
}

/** 计算有序列表的序号 */
function getOrderedNumber(infos: BlockInfo[], index: number): number {
  const curr = infos[index];
  let count = 1;
  for (let i = index - 1; i >= 0; i--) {
    const prev = infos[i];
    if (prev.groupType !== 'ordered') break;
    if (prev.indent !== curr.indent) break;
    count++;
  }
  return count;
}

/** 创建列表符号 widget */
function createBulletWidget(symbol: string, indent: number): HTMLElement {
  const span = document.createElement('span');
  span.classList.add('group-bullet-symbol');
  span.textContent = symbol;
  span.setAttribute('contenteditable', 'false');
  return span;
}

function createOrderedWidget(number: number): HTMLElement {
  const span = document.createElement('span');
  span.classList.add('group-ordered-symbol');
  span.textContent = `${number}.`;
  span.setAttribute('contenteditable', 'false');
  return span;
}

function createCheckboxWidget(checked: boolean, view: EditorView, pos: number): HTMLElement {
  const span = document.createElement('span');
  span.classList.add('group-task-checkbox');
  span.textContent = checked ? '☑' : '☐';
  span.setAttribute('contenteditable', 'false');

  span.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const node = view.state.doc.nodeAt(pos);
    if (!node) return;
    const newAttrs = { ...node.attrs.groupAttrs, checked: !checked };
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, groupAttrs: newAttrs }));
  });

  return span;
}

function createCalloutEmoji(emoji: string, view: EditorView, pos: number): HTMLElement {
  const span = document.createElement('span');
  span.classList.add('group-callout-emoji');
  span.textContent = emoji;
  span.setAttribute('contenteditable', 'false');

  const EMOJI_LIST = ['💡', '⚠️', '❌', '✅', 'ℹ️', '🔥', '📌', '💬', '🎯', '⭐'];

  span.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const node = view.state.doc.nodeAt(pos);
    if (!node) return;
    const currentIndex = EMOJI_LIST.indexOf(emoji);
    const nextIndex = (currentIndex + 1) % EMOJI_LIST.length;
    const newAttrs = { ...node.attrs.groupAttrs, emoji: EMOJI_LIST[nextIndex] };
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, groupAttrs: newAttrs }));
  });

  return span;
}

function createToggleArrow(open: boolean, view: EditorView, pos: number): HTMLElement {
  const span = document.createElement('span');
  span.classList.add('group-toggle-arrow');
  span.textContent = open ? '▾' : '▸';
  span.setAttribute('contenteditable', 'false');

  span.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const node = view.state.doc.nodeAt(pos);
    if (!node) return;
    const newAttrs = { ...node.attrs.groupAttrs, open: !open };
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, groupAttrs: newAttrs }));
  });

  return span;
}

/** 构建 Decoration */
function buildDecorations(doc: PMNode, view: EditorView): DecorationSet {
  const infos = scanBlocks(doc);
  const decorations: Decoration[] = [];

  for (let i = 0; i < infos.length; i++) {
    const info = infos[i];
    if (!info.groupType) continue;

    const position = getGroupPosition(doc, i, infos);

    // Node decoration: CSS class
    const classes = [`group-${info.groupType}`, `group-${position}`];

    // Toggle 子内容隐藏
    if (info.groupType === 'toggle' && position !== 'first' && position !== 'only') {
      // 查找组首行的 open 状态
      let firstIdx = i;
      while (firstIdx > 0 && infos[firstIdx - 1].groupType === 'toggle') firstIdx--;
      const firstAttrs = infos[firstIdx].groupAttrs;
      const isOpen = firstAttrs?.open !== false;
      if (!isOpen) classes.push('group-toggle-hidden');
    }

    // Task checked
    if (info.groupType === 'task' && info.groupAttrs?.checked) {
      classes.push('group-task-checked');
    }

    decorations.push(
      Decoration.node(info.pos, info.pos + info.size, { class: classes.join(' ') })
    );

    // Widget decorations (列表符号、checkbox、emoji、折叠箭头)
    const widgetPos = info.pos + 1; // 在 textBlock 内容开头插入

    if (info.groupType === 'bullet') {
      const symbols = ['•', '◦', '▪'];
      const symbol = symbols[info.indent % symbols.length];
      decorations.push(
        Decoration.widget(widgetPos, () => createBulletWidget(symbol, info.indent), { side: -1 })
      );
    }

    if (info.groupType === 'ordered') {
      const number = getOrderedNumber(infos, i);
      decorations.push(
        Decoration.widget(widgetPos, () => createOrderedWidget(number), { side: -1 })
      );
    }

    if (info.groupType === 'task') {
      const checked = !!info.groupAttrs?.checked;
      decorations.push(
        Decoration.widget(widgetPos, () => createCheckboxWidget(checked, view, info.pos), { side: -1 })
      );
    }

    if (info.groupType === 'callout' && (position === 'first' || position === 'only')) {
      const emoji = (info.groupAttrs?.emoji as string) || '💡';
      decorations.push(
        Decoration.widget(widgetPos, () => createCalloutEmoji(emoji, view, info.pos), { side: -1 })
      );
    }

    if (info.groupType === 'toggle' && (position === 'first' || position === 'only')) {
      const open = info.groupAttrs?.open !== false;
      decorations.push(
        Decoration.widget(widgetPos, () => createToggleArrow(open, view, info.pos), { side: -1 })
      );
    }
  }

  return DecorationSet.create(doc, decorations);
}

export function groupDecorationPlugin(): Plugin {
  let editorView: EditorView | null = null;

  return new Plugin({
    key: groupDecorationKey,

    view(v) {
      editorView = v;
      return {
        update(view) { editorView = view; },
      };
    },

    state: {
      init(_, state) {
        return DecorationSet.empty;
      },
      apply(tr, oldSet, oldState, newState) {
        if (tr.docChanged && editorView) {
          return buildDecorations(newState.doc, editorView);
        }
        return oldSet;
      },
    },

    props: {
      decorations(state) {
        const set = groupDecorationKey.getState(state) as DecorationSet;
        // 首次构建（init 返回 empty）
        if (set === DecorationSet.empty && editorView) {
          return buildDecorations(state.doc, editorView);
        }
        return set;
      },
    },
  });
}
