import { Plugin } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import { blockRegistry } from '../registry';

/**
 * Container Keyboard Plugin — 所有 ContainerBlock 的统一键盘处理
 *
 * 一个插件、一套规则：
 *
 * Enter（有内容）→ 在 Container 内创建新 textBlock
 * Enter（空行）  → 退出 Container（移到容器后方）
 * Backspace（行首）→ 退出 Container（unwrap 当前行）
 *
 * 判断依据：光标所在 textBlock 的父节点是否是 Container（有 containerRule）
 */

export function containerKeyboardPlugin(): Plugin {
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        const { state } = view;
        const { $from } = state.selection;

        // 至少 depth=2 才可能在 Container 内（doc > Container > textBlock）
        if ($from.depth < 2) return false;

        let containerDepth = $from.depth - 1;
        let parentNode = $from.node(containerDepth);
        let parentDef = blockRegistry.get(parentNode.type.name);

        // 只处理有 containerRule 的父节点（ContainerBlock）或 RenderBlock（image/audio/video/tweet 的 caption）
        const isContainer = !!parentDef?.containerRule;
        const RENDER_BLOCK_TYPES = new Set(['image', 'audioBlock', 'videoBlock', 'tweetBlock']);
        const isRenderBlockCaption = !isContainer && RENDER_BLOCK_TYPES.has(parentNode.type.name);
        if (!isContainer && !isRenderBlockCaption) return false;

        // taskItem 是中间层：Enter/Backspace 需要在 taskList 层级操作
        // 向上找到 taskList 作为真正的容器
        let taskListDepth = -1;
        if (parentNode.type.name === 'taskItem' && containerDepth >= 2) {
          const grandparent = $from.node(containerDepth - 1);
          if (grandparent.type.name === 'taskList') {
            taskListDepth = containerDepth - 1;
          }
        }

        const childNode = $from.parent; // 当前 textBlock
        const childDepth = $from.depth;

        // ── Enter ──
        if (event.key === 'Enter' && !event.shiftKey) {
          // RenderBlock caption:
          //   光标前是 hardBreak 且光标后无内容 → 删掉 hardBreak，退出到外部新建 paragraph
          //   否则 → 插入 hardBreak（软换行）
          if (isRenderBlockCaption) {
            event.preventDefault();
            const isEmpty = childNode.content.size === 0;

            // 检测"双回车退出"：光标前一个节点是 hardBreak，且光标在末尾
            const posInParent = $from.parentOffset;
            const atEnd = posInParent >= childNode.content.size;
            let prevIsHardBreak = false;
            if (posInParent > 0) {
              const resolved = $from;
              // 向前查找：光标前的 inline node
              const before = resolved.nodeBefore;
              if (before && before.type.name === 'hardBreak') {
                prevIsHardBreak = true;
              }
            }

            if (isEmpty || (prevIsHardBreak && atEnd)) {
              // RenderBlock 专用退出：不删 caption，只在 block 后方插入新 paragraph
              let tr = state.tr;
              // 如果末尾有 hardBreak，先删掉
              if (prevIsHardBreak) {
                tr = tr.delete($from.pos - 1, $from.pos);
              }
              // 在 RenderBlock 后方插入新 textBlock
              const renderBlockEnd = $from.after(containerDepth);
              const mappedEnd = tr.mapping.map(renderBlockEnd);
              const newBlock = state.schema.nodes.textBlock.create();
              tr = tr.insert(mappedEnd, newBlock);
              tr = tr.setSelection(TextSelection.create(tr.doc, mappedEnd + 1));
              view.dispatch(tr);
            } else {
              // 插入 hardBreak（软换行）
              const { schema } = state;
              if (schema.nodes.hardBreak) {
                const tr = state.tr.replaceSelectionWith(schema.nodes.hardBreak.create());
                view.dispatch(tr);
              }
            }
            return true;
          }

          event.preventDefault();

          const isEmpty = childNode.content.size === 0;

          if (isEmpty && taskListDepth >= 0) {
            // taskList 内空行 Enter → 退出 taskItem（在 taskList 层级操作）
            exitContainer(view, taskListDepth, containerDepth); // containerDepth = taskItem depth
          } else if (isEmpty) {
            // 空行 Enter → 退出 Container
            exitContainer(view, containerDepth, childDepth);
          } else if (taskListDepth >= 0) {
            // taskList 内有内容 → 创建新 taskItem
            splitInContainer(view, taskListDepth, childDepth);
          } else {
            // 有内容 → 在 Container 内创建新子节点
            splitInContainer(view, containerDepth, childDepth);
          }
          return true;
        }

        // ── Backspace（行首） ──
        if (event.key === 'Backspace') {
          // RenderBlock caption: 行首 Backspace → 不做任何事（防止删除 RenderBlock）
          if (isRenderBlockCaption) {
            const atStart = $from.parentOffset === 0;
            if (atStart) {
              event.preventDefault();
              return true; // 吞掉事件，不删除
            }
            return false; // 非行首，正常删除文字
          }

          const atStart = $from.parentOffset === 0;
          if (!atStart) return false;

          // 如果是 Container 的第一个子节点 → 退出 Container
          const containerStart = $from.before(containerDepth);
          const childStart = $from.before(childDepth);
          const isFirstChild = childStart === containerStart + 1;

          if (isFirstChild) {
            event.preventDefault();
            unwrapFromContainer(view, containerDepth, childDepth);
            return true;
          }

          // 非首子 → 与上一个子节点合并（让 ProseMirror 默认处理）
          return false;
        }

        return false;
      },
    },
  });
}

/**
 * 退出 Container：删除空行，在容器后创建 textBlock
 * 如果容器变空，删除容器。
 */
function exitContainer(
  view: import('prosemirror-view').EditorView,
  containerDepth: number,
  childDepth: number,
): void {
  const { state } = view;
  const { $from } = state.selection;

  const containerStart = $from.before(containerDepth);
  const childStart = $from.before(childDepth);
  const childEnd = $from.after(childDepth);

  let tr = state.tr;

  // 删除空的子节点
  tr = tr.delete(childStart, childEnd);

  // 检查容器是否变空
  const updatedContainer = tr.doc.nodeAt(containerStart);
  if (updatedContainer && updatedContainer.content.size === 0) {
    // 容器空了 → 删除容器，创建 textBlock
    tr = tr.delete(containerStart, containerStart + updatedContainer.nodeSize);
    const newBlock = state.schema.nodes.textBlock.create();
    tr = tr.insert(containerStart, newBlock);
    tr = tr.setSelection(TextSelection.create(tr.doc, containerStart + 1));
  } else {
    // 容器还有内容 → 在容器后创建 textBlock
    const newContainerEnd = containerStart + (tr.doc.nodeAt(containerStart)?.nodeSize ?? 0);
    const newBlock = state.schema.nodes.textBlock.create();
    tr = tr.insert(newContainerEnd, newBlock);
    tr = tr.setSelection(TextSelection.create(tr.doc, newContainerEnd + 1));
  }

  view.dispatch(tr);
}

/**
 * 根据父容器类型创建正确的新子节点。
 * taskList 内需要创建 taskItem > textBlock，其他容器直接创建 textBlock。
 */
function createNewChild(
  view: import('prosemirror-view').EditorView,
  containerDepth: number,
): import('prosemirror-model').Node {
  const { state } = view;
  const { $from } = state.selection;
  const parentNode = $from.node(containerDepth);

  if (parentNode.type.name === 'taskList' && state.schema.nodes.taskItem) {
    const nowISO = new Date().toISOString();
    return state.schema.nodes.taskItem.create(
      { createdAt: nowISO },
      [state.schema.nodes.textBlock.create()],
    );
  }

  return state.schema.nodes.textBlock.create();
}

/**
 * 在 Container 内分裂：光标位置创建新子节点
 */
function splitInContainer(
  view: import('prosemirror-view').EditorView,
  containerDepth: number,
  childDepth: number,
): void {
  const { state } = view;
  const { $from } = state.selection;
  const cursorOffset = $from.parentOffset;
  const childNode = $from.parent;
  const parentNode = $from.node(containerDepth);
  const isTaskList = parentNode.type.name === 'taskList';

  // taskList 内的 Enter 需要在 taskItem 层级操作
  const insertDepth = isTaskList ? containerDepth + 1 : childDepth;

  let tr = state.tr;

  if (cursorOffset === childNode.content.size) {
    // 光标在末尾 → 在当前项之后插入新子节点
    const insertPos = $from.after(insertDepth);
    const newChild = createNewChild(view, containerDepth);
    tr = tr.insert(insertPos, newChild);
    tr = tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1)));
  } else if (cursorOffset === 0) {
    // 光标在开头 → 在当前项之前插入新子节点
    const insertPos = $from.before(insertDepth);
    const newChild = createNewChild(view, containerDepth);
    tr = tr.insert(insertPos, newChild);
    tr = tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + newChild.nodeSize + 1)));
  } else {
    // 光标在中间 → 分裂
    if (isTaskList) {
      // taskList: split 在 textBlock 层级，然后再 split 在 taskItem 层级
      tr = tr.split($from.pos, 2);
      // 新的 taskItem 需要设置 createdAt
      const newTaskItemPos = $from.after(insertDepth);
      const mappedPos = tr.mapping.map(newTaskItemPos);
      const newTaskItem = tr.doc.nodeAt(mappedPos);
      if (newTaskItem && newTaskItem.type.name === 'taskItem') {
        tr = tr.setNodeMarkup(mappedPos, undefined, {
          ...newTaskItem.attrs,
          createdAt: new Date().toISOString(),
          checked: false,
          completedAt: null,
        });
      }
    } else {
      tr = tr.split($from.pos, 1);
    }
  }

  view.dispatch(tr);
}

/**
 * Unwrap：将当前 textBlock 从 Container 中提取出来
 */
function unwrapFromContainer(
  view: import('prosemirror-view').EditorView,
  containerDepth: number,
  childDepth: number,
): void {
  const { state } = view;
  const { $from } = state.selection;

  const containerStart = $from.before(containerDepth);
  const childStart = $from.before(childDepth);
  const childEnd = $from.after(childDepth);
  const childNode = $from.parent;

  let tr = state.tr;

  // 复制当前 textBlock
  const copy = childNode.copy(childNode.content);

  // 从 Container 中删除
  tr = tr.delete(childStart, childEnd);

  // 检查容器是否变空
  const updatedContainer = tr.doc.nodeAt(containerStart);
  if (updatedContainer && updatedContainer.content.size === 0) {
    // 容器空了 → 替换容器为 textBlock
    tr = tr.replaceWith(containerStart, containerStart + updatedContainer.nodeSize, copy);
  } else {
    // 容器还有内容 → 在容器前插入 textBlock
    tr = tr.insert(containerStart, copy);
  }

  // 光标放到提取出的 textBlock 内
  tr = tr.setSelection(TextSelection.create(tr.doc, containerStart + 1));

  view.dispatch(tr);
}
