import type { EditorState, Transaction } from 'prosemirror-state';
import { Fragment } from 'prosemirror-model';

/**
 * setTextBlockLevel —— 把指定位置的 textBlock 切换到目标 level（null = paragraph，1/2/3 = heading）。
 *
 * 当 textBlock 是 orderedList 的直接子项且要变成 heading 时，会把它从列表中提取出来：
 * 提取的文字前会插入当前编号（如 "1. "）作为普通字符；剩余项保持原编号语义
 * （前段保留原 start，后段从 1 开始）。
 *
 * 这个函数同时被键盘快捷键（Cmd+Alt+1/2/3、Cmd+Alt+0）和 HandleMenu turn-into 调用，
 * 确保两条路径行为一致。
 */
export function setTextBlockLevel(
  state: EditorState,
  pos: number,
  level: number | null,
): Transaction | null {
  const node = state.doc.nodeAt(pos);
  if (!node || node.type.name !== 'textBlock' || node.attrs.isTitle) return null;

  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;

  // 仅在「转 heading」且「父节点是 orderedList」时走提取路径。
  // 转回 paragraph（level=null）不做反向重组——重新加入列表交给用户手动处理。
  if (level !== null && parent.type.name === 'orderedList') {
    return liftToHeading(state, pos, level);
  }

  return state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, level });
}

/**
 * 把 orderedList 中的某项提升为 heading，序号作为普通文字注入到内容前。
 *
 * 处理四种切割情况：
 *   - 列表只剩这一项：删除整个列表容器，留下 heading
 *   - 当前是首项：列表 → heading + 原列表(剩余项, start=1)
 *   - 当前是末项：列表 → 原列表(前面项) + heading
 *   - 当前在中间：列表 → 原列表(前段) + heading + 原列表(后段, start=1)
 */
function liftToHeading(
  state: EditorState,
  itemPos: number,
  level: number,
): Transaction | null {
  const itemNode = state.doc.nodeAt(itemPos);
  if (!itemNode) return null;

  const $item = state.doc.resolve(itemPos);
  const list = $item.parent;
  if (list.type.name !== 'orderedList') return null;

  const listDepth = $item.depth;
  const listStart = $item.before(listDepth);
  const listEnd = $item.after(listDepth);
  const startAttr = (list.attrs.start as number) ?? 1;

  // 找到当前项在列表中的索引
  const itemIndex = $item.index(listDepth);
  const orderNumber = startAttr + itemIndex;

  const schema = state.schema;
  const textBlockType = schema.nodes.textBlock;
  const orderedListType = schema.nodes.orderedList;

  // 拼接序号文字 + 原内容
  const prefix = schema.text(`${orderNumber}. `);
  const newContent = Fragment.from(prefix).append(itemNode.content);
  const headingNode = textBlockType.create(
    { ...itemNode.attrs, level },
    newContent,
  );

  // 切割剩余项
  const before: typeof itemNode[] = [];
  const after: typeof itemNode[] = [];
  list.forEach((child, _offset, idx) => {
    if (idx < itemIndex) before.push(child);
    else if (idx > itemIndex) after.push(child);
  });

  const replacement: typeof itemNode[] = [];
  if (before.length > 0) {
    replacement.push(orderedListType.create({ start: startAttr }, Fragment.fromArray(before)));
  }
  replacement.push(headingNode);
  if (after.length > 0) {
    replacement.push(orderedListType.create({ start: 1 }, Fragment.fromArray(after)));
  }

  const tr = state.tr.replaceWith(listStart, listEnd, Fragment.fromArray(replacement));
  return tr;
}
