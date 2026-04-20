import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { THOUGHT_ACTION } from '../../thought/thought-protocol';
import { THOUGHT_TYPE_META } from '../../../shared/types/thought-types';

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

    // Block 级 thought 标注现在使用框定系统（block-frame plugin），
    // 不再在 thought-plugin 中维护 decoration。

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
      handleClick(view: EditorView, pos: number, event: MouseEvent) {
        // 1. inline thought mark
        const target = event.target as HTMLElement;
        const anchor = target.closest('[data-thought-id]') as HTMLElement | null;
        let thoughtId = anchor?.getAttribute('data-thought-id') || null;

        // 2. block thought（frameThoughtId attr）
        if (!thoughtId) {
          const resolved = view.state.doc.resolve(pos);
          for (let d = resolved.depth; d >= 0; d--) {
            const fid = resolved.node(d).attrs.frameThoughtId;
            if (fid) { thoughtId = fid; break; }
          }
        }

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

      handleDoubleClick(view: EditorView, pos: number, event: MouseEvent) {
        const target = event.target as HTMLElement;
        const anchor = target.closest('[data-thought-id]') as HTMLElement | null;
        let thoughtId = anchor?.getAttribute('data-thought-id') || null;

        if (!thoughtId) {
          const resolved = view.state.doc.resolve(pos);
          for (let d = resolved.depth; d >= 0; d--) {
            const fid = resolved.node(d).attrs.frameThoughtId;
            if (fid) { thoughtId = fid; break; }
          }
        }

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

/** 移除文档中指定 thoughtId 的 mark、node attr 和 block 框定 */
function removeThoughtMark(view: EditorView, thoughtId: string): void {
  const { state } = view;
  const { tr } = state;
  const thoughtMarkType = state.schema.marks.thought;
  let changed = false;

  // 1. inline thought mark
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

  // 2. node-level thought attr
  state.doc.descendants((node, pos) => {
    if (node.attrs.thoughtId === thoughtId) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, thoughtId: null });
      changed = true;
    }
  });

  // 3. block thought 框定（frameThoughtId）→ 清除框定 + thoughtId
  state.doc.descendants((node, pos) => {
    if (node.attrs.frameThoughtId === thoughtId) {
      tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        frameThoughtId: null,
        frameColor: null,
        frameStyle: null,
        frameGroupId: null,
      });
      changed = true;
    }
  });

  if (changed) {
    view.dispatch(tr);
  }
}

/** 更新 thought 标注的类型属性（颜色跟随类型变化） */
function updateThoughtType(view: EditorView, thoughtId: string, newType: string): void {
  const { state } = view;
  const { tr } = state;
  const thoughtMarkType = state.schema.marks.thought;
  let changed = false;

  // 1. inline thought mark
  if (thoughtMarkType) {
    state.doc.descendants((node, pos) => {
      node.marks.forEach((mark) => {
        if (mark.type === thoughtMarkType && mark.attrs.thoughtId === thoughtId) {
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

  // 2. block thought 框定颜色同步
  const newColor = THOUGHT_TYPE_META[newType as keyof typeof THOUGHT_TYPE_META]?.color;
  if (newColor) {
    state.doc.descendants((node, pos) => {
      if (node.attrs.frameThoughtId === thoughtId) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, frameColor: newColor });
        changed = true;
      }
    });
  }

  if (changed) {
    view.dispatch(tr);
  }
}

/** 收集当前视口内可见的 thought anchor ID */
function getVisibleThoughtIds(view: EditorView): string[] {
  const ids: string[] = [];
  const scrollParent = view.dom.closest('.ProseMirror-scroll') || view.dom.parentElement;
  if (!scrollParent) return ids;
  const rect = scrollParent.getBoundingClientRect();

  // 1. inline thought marks
  const anchors = view.dom.querySelectorAll('[data-thought-id]');
  anchors.forEach((el) => {
    const elRect = el.getBoundingClientRect();
    if (elRect.bottom > rect.top && elRect.top < rect.bottom) {
      const id = el.getAttribute('data-thought-id');
      if (id && !ids.includes(id)) ids.push(id);
    }
  });

  // 2. block thoughts（frameThoughtId attr）
  view.state.doc.descendants((node, pos) => {
    const fid = node.attrs.frameThoughtId;
    if (!fid || ids.includes(fid)) return;
    const dom = view.nodeDOM(pos) as HTMLElement | null;
    if (dom) {
      const elRect = dom.getBoundingClientRect();
      if (elRect.bottom > rect.top && elRect.top < rect.bottom) {
        ids.push(fid);
      }
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

/** 滚动到指定 thought 锚点并闪烁高亮 */
function scrollToThoughtAnchor(view: EditorView, thoughtId: string): void {
  // 1. inline thought mark（data-thought-id DOM 属性）
  const el = view.dom.querySelector(`[data-thought-id="${thoughtId}"]`) as HTMLElement | null;
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('thought-anchor--active');
    setTimeout(() => el.classList.remove('thought-anchor--active'), 1500);
    return;
  }

  // 2. node-level thought（thoughtId attr）或 block thought（frameThoughtId attr）
  view.state.doc.descendants((node, pos) => {
    if (node.attrs.thoughtId === thoughtId || node.attrs.frameThoughtId === thoughtId) {
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
