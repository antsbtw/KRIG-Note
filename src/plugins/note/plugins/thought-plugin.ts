import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { THOUGHT_ACTION } from '../../thought/thought-protocol';

/**
 * thoughtPlugin — Note 侧的 Thought 交互插件
 *
 * 处理：
 * 1. 点击 thought mark → 发送 activate 消息到 Thought 面板
 * 2. 接收 delete 消息 → 移除对应 mark / node attr
 * 3. 接收 scroll-to-anchor 消息 → 滚动到锚点位置并闪烁
 * 4. 接收 type-change 消息 → 更新 mark 的 thoughtType attr（颜色同步）
 */

const viewAPI = () => (window as any).viewAPI as {
  sendToOtherSlot: (msg: any) => void;
  onMessage: (cb: (msg: any) => void) => () => void;
  ensureRightSlot: (workModeId: string) => Promise<void>;
} | undefined;

export const thoughtPluginKey = new PluginKey('thought');

export function thoughtPlugin(): Plugin {
  let unsubMessage: (() => void) | null = null;
  let scrollTimer: ReturnType<typeof setTimeout> | null = null;
  let scrollHandler: (() => void) | null = null;

  return new Plugin({
    key: thoughtPluginKey,

    state: {
      init(_, state) {
        return buildBlockThoughtDecorations(state.doc, state.schema.marks.thought);
      },
      apply(tr, value, _oldState, newState) {
        if (!tr.docChanged) return value;
        return buildBlockThoughtDecorations(newState.doc, newState.schema.marks.thought);
      },
    },

    view(editorView: EditorView) {
      const api = viewAPI();
      if (api) {
        unsubMessage = api.onMessage((msg) => {
          if (msg.protocol && msg.protocol !== 'note-thought') return;

          if (msg.action === THOUGHT_ACTION.DELETE) {
            removeThoughtMark(editorView, (msg.payload as any).thoughtId);
          }
          if (msg.action === THOUGHT_ACTION.SCROLL_TO_ANCHOR) {
            scrollToThoughtAnchor(editorView, (msg.payload as any).thoughtId);
          }
          if (msg.action === THOUGHT_ACTION.TYPE_CHANGE) {
            const { thoughtId, newType } = msg.payload as any;
            updateThoughtType(editorView, thoughtId, newType);
          }
          if (msg.action === THOUGHT_ACTION.AI_RESPONSE_READY) {
            const { thoughtId } = msg.payload as any;
            updateThoughtAnchorState(editorView, thoughtId, 'ready');
          }
          if (msg.action === THOUGHT_ACTION.AI_ERROR) {
            const { thoughtId } = msg.payload as any;
            updateThoughtAnchorState(editorView, thoughtId, 'error');
          }
        });

        // SCROLL_SYNC: 滚动时收集可见锚点 ID，节流发送给 ThoughtView
        scrollHandler = () => {
          if (scrollTimer) return;
          scrollTimer = setTimeout(() => {
            scrollTimer = null;
            const visibleIds = getVisibleThoughtIds(editorView);
            if (visibleIds.length > 0) {
              api.sendToOtherSlot({
                protocol: 'note-thought',
                action: THOUGHT_ACTION.SCROLL_SYNC,
                payload: { visibleIds },
              });
            }
          }, 300);
        };
        const scrollTarget = editorView.dom.closest('.ProseMirror-scroll') || editorView.dom.parentElement;
        scrollTarget?.addEventListener('scroll', scrollHandler, { passive: true });
      }

      return {
        destroy() {
          unsubMessage?.();
          if (scrollHandler) {
            const scrollTarget = editorView.dom.closest('.ProseMirror-scroll') || editorView.dom.parentElement;
            scrollTarget?.removeEventListener('scroll', scrollHandler);
          }
          if (scrollTimer) clearTimeout(scrollTimer);
        },
      };
    },

    props: {
      decorations(state) {
        return thoughtPluginKey.getState(state);
      },

      handleClick(view: EditorView, _pos: number, event: MouseEvent) {
        const target = event.target as HTMLElement;
        const anchor = target.closest('[data-thought-id]') as HTMLElement | null;
        if (!anchor) return false;

        const thoughtId = anchor.getAttribute('data-thought-id');
        if (!thoughtId) return false;

        const api = viewAPI();
        if (api) {
          api.sendToOtherSlot({
            protocol: 'note-thought',
            action: THOUGHT_ACTION.ACTIVATE,
            payload: { thoughtId },
          });
        }

        return false;
      },

      handleDoubleClick(view: EditorView, _pos: number, event: MouseEvent) {
        const target = event.target as HTMLElement;
        const anchor = target.closest('[data-thought-id]') as HTMLElement | null;
        if (!anchor) return false;

        const thoughtId = anchor.getAttribute('data-thought-id');
        if (!thoughtId) return false;

        // 双击 thought 锚点 → 打开 ThoughtView 并激活对应卡片
        const api = viewAPI();
        if (api) {
          api.ensureRightSlot('thought');
          // 延迟发送 ACTIVATE，等 ThoughtView 加载
          setTimeout(() => {
            api.sendToOtherSlot({
              protocol: 'note-thought',
              action: THOUGHT_ACTION.ACTIVATE,
              payload: { thoughtId },
            });
          }, 300);
        }

        return true; // 阻止默认双击选词行为
      },
    },
  });
}

/** 移除文档中指定 thoughtId 的 mark 和 node attr */
function removeThoughtMark(view: EditorView, thoughtId: string): void {
  const { state } = view;
  const { tr } = state;
  const thoughtMarkType = state.schema.marks.thought;
  let changed = false;

  if (thoughtMarkType) {
    state.doc.descendants((node, pos) => {
      node.marks.forEach((mark) => {
        if (mark.type === thoughtMarkType && mark.attrs.thoughtId === thoughtId) {
          tr.removeMark(pos, pos + node.nodeSize, mark);
          changed = true;
        }
      });
    });
  }

  state.doc.descendants((node, pos) => {
    if (node.attrs.thoughtId === thoughtId) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, thoughtId: null });
      changed = true;
    }
  });

  if (changed) {
    view.dispatch(tr);
  }
}

/** 更新 thought mark 的 thoughtType 属性（颜色跟随类型变化） */
function updateThoughtType(view: EditorView, thoughtId: string, newType: string): void {
  const { state } = view;
  const { tr } = state;
  const thoughtMarkType = state.schema.marks.thought;
  let changed = false;

  if (thoughtMarkType) {
    state.doc.descendants((node, pos) => {
      node.marks.forEach((mark) => {
        if (mark.type === thoughtMarkType && mark.attrs.thoughtId === thoughtId) {
          // 移除旧 mark，添加新 mark（ProseMirror 中更新 mark attrs 的标准方式）
          tr.removeMark(pos, pos + node.nodeSize, mark);
          tr.addMark(pos, pos + node.nodeSize, thoughtMarkType.create({
            thoughtId,
            thoughtType: newType,
          }));
          changed = true;
        }
      });
    });
  }

  if (changed) {
    view.dispatch(tr);
  }
}

/** 收集当前视口内可见的 thought anchor ID */
function getVisibleThoughtIds(view: EditorView): string[] {
  const anchors = view.dom.querySelectorAll('[data-thought-id]');
  const ids: string[] = [];
  const scrollParent = view.dom.closest('.ProseMirror-scroll') || view.dom.parentElement;
  if (!scrollParent) return ids;

  const rect = scrollParent.getBoundingClientRect();
  anchors.forEach((el) => {
    const elRect = el.getBoundingClientRect();
    // 元素与视口有交集即算可见
    if (elRect.bottom > rect.top && elRect.top < rect.bottom) {
      const id = el.getAttribute('data-thought-id');
      if (id && !ids.includes(id)) ids.push(id);
    }
  });
  return ids;
}

/** 更新 thought 锚点的 AI 状态（pending → ready / error） */
function updateThoughtAnchorState(view: EditorView, thoughtId: string, aiState: 'ready' | 'error'): void {
  const el = view.dom.querySelector(`[data-thought-id="${thoughtId}"]`) as HTMLElement | null;
  if (el) {
    el.classList.remove('thought-anchor--ai-pending');
    el.classList.add(`thought-anchor--ai-${aiState}`);
    if (aiState === 'ready') {
      // 短暂闪烁表示完成
      el.classList.add('thought-anchor--active');
      setTimeout(() => el.classList.remove('thought-anchor--active'), 1500);
    }
  }
}

/** 在一个 block 节点内查找 block 级 thought mark */
function findBlockThoughtMark(
  node: import('prosemirror-model').Node,
  thoughtMarkType: import('prosemirror-model').MarkType,
): { thoughtId: string; thoughtType: string } | null {
  let result: { thoughtId: string; thoughtType: string } | null = null;
  node.descendants((child) => {
    if (result) return false;
    for (const mark of child.marks) {
      if (mark.type === thoughtMarkType && mark.attrs.anchorType === 'block') {
        result = { thoughtId: mark.attrs.thoughtId, thoughtType: mark.attrs.thoughtType || 'thought' };
        return false;
      }
    }
  });
  return result;
}

/**
 * 构建 block 级 thought 的 node decoration
 *
 * 扫描文档中所有 anchorType==='block' 的 thought mark，
 * 按 thoughtId 分组连续 block，给每个 block 添加线框样式 class。
 */
function buildBlockThoughtDecorations(
  doc: import('prosemirror-model').Node,
  thoughtMarkType: import('prosemirror-model').MarkType | undefined,
): DecorationSet {
  if (!thoughtMarkType) return DecorationSet.empty;

  // 收集每个 top-level block 上的 block 级 thought mark
  const blockThoughts: { pos: number; size: number; thoughtId: string; thoughtType: string }[] = [];

  doc.forEach((node, offset) => {
    if (!node.isBlock) return;
    // 检查该 block 内的文本节点是否带有 block 级 thought mark
    const found = findBlockThoughtMark(node, thoughtMarkType);
    if (found) {
      blockThoughts.push({ pos: offset, size: node.nodeSize, thoughtId: found.thoughtId, thoughtType: found.thoughtType });
    }
  });

  if (blockThoughts.length === 0) return DecorationSet.empty;

  // 按 thoughtId 分组连续 block
  const groups = new Map<string, typeof blockThoughts>();
  for (const bt of blockThoughts) {
    const list = groups.get(bt.thoughtId) || [];
    list.push(bt);
    groups.set(bt.thoughtId, list);
  }

  const decorations: Decoration[] = [];

  for (const [thoughtId, blocks] of groups) {
    const thoughtType = blocks[0].thoughtType;
    const count = blocks.length;

    blocks.forEach((bt, i) => {
      let position: string;
      if (count === 1) {
        position = 'only';
      } else if (i === 0) {
        position = 'first';
      } else if (i === count - 1) {
        position = 'last';
      } else {
        position = 'middle';
      }

      decorations.push(
        Decoration.node(bt.pos, bt.pos + bt.size, {
          class: `thought-block-frame thought-block-frame--${position}`,
          'data-thought-id': thoughtId,
          'data-thought-type': thoughtType,
        }),
      );
    });
  }

  return DecorationSet.create(doc, decorations);
}

/** 滚动到指定 thought 锚点并闪烁高亮 */
function scrollToThoughtAnchor(view: EditorView, thoughtId: string): void {
  const el = view.dom.querySelector(`[data-thought-id="${thoughtId}"]`) as HTMLElement | null;
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('thought-anchor--active');
    setTimeout(() => el.classList.remove('thought-anchor--active'), 1500);
    return;
  }

  view.state.doc.descendants((node, pos) => {
    if (node.attrs.thoughtId === thoughtId) {
      const dom = view.nodeDOM(pos) as HTMLElement | null;
      if (dom) {
        dom.scrollIntoView({ behavior: 'smooth', block: 'center' });
        dom.classList.add('thought-anchor--active');
        setTimeout(() => dom.classList.remove('thought-anchor--active'), 1500);
      }
      return false;
    }
  });
}
